import { type CssNode, generate, ident, List, parse as parseCss, walk } from "css-tree"
import { type DefaultTreeAdapterTypes as Html, parse, serialize } from "parse5"

const inertTags = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
])
const loadingAttributes = new Set([
  "href",
  "srcset",
  "imagesrcset",
  "srcdoc",
  "action",
  "formaction",
  "poster",
  "background",
  "ping",
  "base",
])

const localResource = (value: string) =>
  value.startsWith("#") ||
  /^data:(?:image\/|font\/|application\/(?:font|x-font|octet-stream))/i.test(value)

/** Resource preparation uses plain syntax trees, so untrusted CSS never reaches a live DOM. */
export function localArtifactCss(
  css: string,
  context: "stylesheet" | "declarationList" = "stylesheet",
): string {
  try {
    const tree = parseCss(css, { context, parseCustomProperty: true })
    walk(tree, function (node, item, list) {
      if (
        node.type === "Atrule" &&
        ident.decode(node.name).toLowerCase() === "import" &&
        item &&
        list
      ) {
        list.remove(item)
        return
      }
      if (node.type === "Url" && !localResource(node.value)) node.value = "data:,"
      if (node.type === "Raw") {
        if (!this.declaration) throw new Error("Unparsed CSS")
        this.declaration.value = {
          type: "Value",
          children: new List<CssNode>().fromArray([{ type: "Identifier", name: "none" }]),
        }
        return this.skip
      }
      if (
        node.type === "Function" &&
        ["image-set", "-webkit-image-set", "image", "src"].includes(
          ident.decode(node.name).toLowerCase(),
        )
      ) {
        const resource = node.children
          .toArray()
          .find(
            (child) =>
              (child.type === "Url" || child.type === "String") && localResource(child.value),
          )
        if (item && list)
          list.replace(
            item,
            list.createItem(
              resource && (resource.type === "Url" || resource.type === "String")
                ? { type: "Url", value: resource.value }
                : { type: "Identifier", name: "none" },
            ),
          )
        return this.skip
      }
    })
    return generate(tree).replaceAll("<", "\\3c ")
  } catch {
    return ""
  }
}

function portableWebLink(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      url.hostname !== "localhost" &&
      url.hostname !== "[::1]" &&
      !url.hostname.startsWith("127.")
    )
  } catch {
    return false
  }
}

export function prepareSharedArtifact(html: string, options: { links?: boolean } = {}): string {
  const tree = parse(html)
  const visit = (parent: Html.ParentNode): void => {
    parent.childNodes = parent.childNodes.filter(
      (node) => !("tagName" in node && inertTags.has(node.tagName.toLowerCase())),
    )
    for (const node of parent.childNodes) {
      if (!("tagName" in node)) continue
      node.attrs = node.attrs
        .filter((attr) => {
          if (
            options.links &&
            node.tagName === "a" &&
            attr.name === "href" &&
            portableWebLink(attr.value)
          )
            return true
          if (
            attr.name.toLowerCase().startsWith("on") ||
            loadingAttributes.has(attr.name.toLowerCase())
          )
            return false
          if (attr.name.toLowerCase() === "src" && !/^data:image\//i.test(attr.value)) return false
          return true
        })
        .map((attr) =>
          attr.name.toLowerCase() === "style"
            ? { ...attr, value: localArtifactCss(attr.value, "declarationList") }
            : attr,
        )
      if (node.tagName.toLowerCase() === "style") {
        const css = node.childNodes
          .filter((child): child is Html.TextNode => child.nodeName === "#text")
          .map((child) => child.value)
          .join("")
        for (const child of node.childNodes)
          if (child.nodeName === "#text" && "value" in child) child.value = localArtifactCss(css)
      }
      visit(node)
      if ("content" in node) visit((node as Html.Template).content)
    }
  }
  visit(tree)
  return serialize(tree)
}
