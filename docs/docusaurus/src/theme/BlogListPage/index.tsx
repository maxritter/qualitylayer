import React, { type ReactNode } from "react";
import clsx from "clsx";
import { PageMetadata, HtmlClassNameProvider, ThemeClassNames } from "@docusaurus/theme-common";
import BlogLayout from "@theme/BlogLayout";
import BlogListPaginator from "@theme/BlogListPaginator";
import SearchMetadata from "@theme/SearchMetadata";
import BlogPostItems from "@theme/BlogPostItems";
import BlogListPageStructuredData from "@theme/BlogListPage/StructuredData";
import type { Props } from "@theme/BlogListPage";

/** The original blog list page, plus the page's one H1: the theme renders post titles as H2 only. */
export default function BlogListPage(props: Props): ReactNode {
  const { metadata, items, sidebar } = props;
  const { blogTitle, blogDescription } = metadata;
  return (
    <HtmlClassNameProvider className={clsx(ThemeClassNames.wrapper.blogPages, ThemeClassNames.page.blogListPage)}>
      <PageMetadata title={blogTitle} description={blogDescription} />
      <SearchMetadata tag="blog_posts_list" />
      <BlogListPageStructuredData {...props} />
      <BlogLayout sidebar={sidebar}>
        <header className="margin-bottom--lg">
          <h1>{blogTitle}: working with coding agents</h1>
          <p>{blogDescription}</p>
        </header>
        <BlogPostItems items={items} />
        <BlogListPaginator metadata={metadata} />
      </BlogLayout>
    </HtmlClassNameProvider>
  );
}
