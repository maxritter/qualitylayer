//! App links only navigate, and only to places the CLI would name. A link is
//! `qualitylayer://task/<id>[/<doc>[/<heading>]]`, `ask/<task>/<ask>`, `team/<task>[/<doc>]`,
//! `step/<task>/<step>`, `artifacts/<project>/<file>`, `machine/<id>[/<place>]` (a place on one of this
//! computer's machines: any of these but another machine) or `update`. Artifact documents have a known encoded
//! folder prefix; other segments are plain (letters, digits and `._~-`, up to 120).
//! Anything else, such as a query, a token, `..` or an unknown place, is refused: the App opens its
//! home page.

/// Where a link takes the App.
#[derive(Debug, PartialEq)]
pub enum Link {
    /// The page's hash route, `#/task/<id>/<doc>`.
    Route(String),
    /// The home page: the link was not a plain place.
    Home,
    /// The update panel.
    Update,
}

#[path = "links_artifact.rs"]
mod artifact;

use artifact::{artifact_document, artifact_section};

const SCHEME: &str = "qualitylayer://";
const MAX_SEGMENT: usize = 120;

fn plain(segment: &str) -> bool {
    let valid_len = !segment.is_empty() && segment.len() <= MAX_SEGMENT;
    let not_dot = segment != "." && segment != "..";
    valid_len
        && not_dot
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._~-".contains(c))
}

/// How many segments follow the area, at least and at most.
fn arity(area: &str) -> Option<(usize, usize)> {
    match area {
        "task" => Some((1, 3)),
        "ask" => Some((2, 2)),
        "team" => Some((1, 2)),
        "step" => Some((2, 2)),
        "artifact" => Some((2, 3)),
        _ => None,
    }
}

/// `machine/<id>[/<place>]`: a machine of this computer's list (the page checks the id against the
/// list) and, optionally, a place on it, which is any place above and never another machine. The route
/// is the page's `#/machine/<id>/<place>`.
fn machine(rest: &[&str]) -> Link {
    let [id, place @ ..] = rest else {
        return Link::Home;
    };
    if !plain(id) {
        return Link::Home;
    }
    if place.is_empty() {
        return Link::Route(format!("#/machine/{id}/"));
    }
    match parse(&format!("{SCHEME}{}", place.join("/"))) {
        Link::Route(inner) if !inner.starts_with("#/machine/") => {
            Link::Route(format!("#/machine/{id}/{}", &inner[2..]))
        }
        _ => Link::Home,
    }
}

fn valid_segment(area: &str, parts: &[&str], index: usize, part: &str) -> bool {
    if index == 3
        && (area == "artifact"
            || (area == "task"
                && parts
                    .get(2)
                    .is_some_and(|file| artifact_document(file, false))))
    {
        return artifact_section(part);
    }
    if index == 2 && area == "artifact" {
        return artifact_document(part, true);
    }
    plain(part) || (index == 2 && matches!(area, "task" | "team") && artifact_document(part, false))
}

fn parse_area(path: &str, area: &str, rest: &[&str], parts: &[&str]) -> Link {
    if area == "machine" {
        return machine(rest);
    }
    let fits = arity(area).is_some_and(|(least, most)| (least..=most).contains(&rest.len()));
    let valid = parts
        .iter()
        .enumerate()
        .all(|(index, part)| valid_segment(area, parts, index, part));
    let literal_artifact_folder =
        matches!(area, "task" | "team") && rest.len() > 2 && rest[1] == "artifacts";
    // The three steps; a link to a step that is gone (Discuss, Research, Outline, Review) opens Home.
    let known_step = area != "step"
        || rest
            .get(1)
            .is_some_and(|step| matches!(*step, "plan" | "implement" | "verify"));
    if fits && valid && !literal_artifact_folder && known_step {
        Link::Route(format!("#/{path}"))
    } else {
        Link::Home
    }
}

pub fn parse(link: &str) -> Link {
    let Some(raw) = link.strip_prefix(SCHEME) else {
        return Link::Home;
    };
    // Windows adds a closing slash to a link that has no path.
    let path = raw.strip_suffix('/').unwrap_or(raw);
    if path == "update" {
        return Link::Update;
    }
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        [area, rest @ ..] => parse_area(path, area, rest, &parts),
        [] => Link::Home,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(link: &str) -> Link {
        Link::Route(format!("#/{}", link.trim_start_matches(SCHEME)))
    }

    #[test]
    fn a_task_an_ask_and_a_team_task_map_to_their_hash_routes() {
        for link in [
            "qualitylayer://task/pilot-shell~2026-10-03-app",
            "qualitylayer://task/pilot-shell~2026-10-03-app/02-design.md",
            "qualitylayer://task/pilot-shell~2026-10-03-app/02-design.md/the-launcher",
            "qualitylayer://ask/t_9c2/7f3a",
            "qualitylayer://team/t_9c2",
            "qualitylayer://team/t_9c2/02-design.md",
            "qualitylayer://step/t_9c2/verify",
        ] {
            assert_eq!(parse(link), route(link), "{link}");
        }
    }

    #[test]
    fn a_machine_and_a_place_on_it_map_to_the_machine_route() {
        for (link, hash) in [
            ("qualitylayer://machine/gpu-box", "#/machine/gpu-box/"),
            ("qualitylayer://machine/gpu-box/", "#/machine/gpu-box/"),
            (
                "qualitylayer://machine/gpu-box/task/p~billing",
                "#/machine/gpu-box/task/p~billing",
            ),
            (
                "qualitylayer://machine/gpu-box/task/p~billing/01-plan.md",
                "#/machine/gpu-box/task/p~billing/01-plan.md",
            ),
            (
                "qualitylayer://machine/gpu-box/ask/t_9c2/7f3a",
                "#/machine/gpu-box/ask/t_9c2/7f3a",
            ),
            (
                "qualitylayer://machine/gpu-box/step/t_9c2/verify",
                "#/machine/gpu-box/step/t_9c2/verify",
            ),
            (
                "qualitylayer://machine/gpu-box/task/repo~task/artifacts%2Fwelcome.html/2%20Billing",
                "#/machine/gpu-box/task/repo~task/artifacts%2Fwelcome.html/2%20Billing",
            ),
        ] {
            assert_eq!(parse(link), Link::Route(hash.into()), "{link}");
        }
    }

    #[test]
    fn a_machine_link_refuses_a_name_that_is_no_machine_and_a_place_that_is_no_place() {
        let long = "x".repeat(MAX_SEGMENT + 1);
        for link in [
            "qualitylayer://machine/../x",
            "qualitylayer://machine/..",
            "qualitylayer://machine/.",
            "qualitylayer://machine",
            "qualitylayer://machine//task/x",
            "qualitylayer://machine/a b/task/x",
            "qualitylayer://machine/gpu-box?token=1",
            "qualitylayer://machine/gpu-box#/task/x",
            "qualitylayer://machine/gpu-box/task/..",
            "qualitylayer://machine/gpu-box/task/x/../y",
            "qualitylayer://machine/gpu-box/task/x?token=1",
            "qualitylayer://machine/gpu-box/task//x",
            "qualitylayer://machine/gpu-box/settings",
            "qualitylayer://machine/gpu-box/update",
            "qualitylayer://machine/gpu-box/anything",
            "qualitylayer://machine/gpu-box/machine/other",
            "qualitylayer://machine/gpu-box/machine/other/task/x",
            "qualitylayer://machine/gpu-box/task/x/y/z/w",
            "qualitylayer://machine/gpu-box/step/t/deploy",
            "qualitylayer://machine/gpu-box/task/repo/artifacts%2F..%2Fsecret.html",
            &format!("qualitylayer://machine/{long}"),
            &format!("qualitylayer://machine/gpu-box/task/{long}"),
        ] {
            assert_eq!(parse(link), Link::Home, "{link}");
        }
        let longest = "x".repeat(MAX_SEGMENT);
        assert_eq!(
            parse(&format!("qualitylayer://machine/{longest}")),
            Link::Route(format!("#/machine/{longest}/"))
        );
    }

    #[test]
    fn the_update_link_opens_the_update_panel() {
        assert_eq!(parse("qualitylayer://update"), Link::Update);
        assert_eq!(parse("qualitylayer://update/"), Link::Update);
    }

    #[test]
    fn artifact_sections_keep_unicode_and_spaces_inside_one_bounded_route_segment() {
        for area in [
            "artifact/repo/.qualitylayer%2Fartifacts%2Fmodel%2Fsettings.html",
            "task/repo~task/artifacts%2Fmodel%2Fsettings.html",
        ] {
            let link = format!("qualitylayer://{area}/2%20Billing%20%2F%20%E8%B4%A6%E5%8D%95");
            assert_eq!(parse(&link), route(&link));
            for section in [
                "%00",
                "%C2%80",
                "%FF",
                "%61",
                "%",
                "bad?query",
                "heading/extra",
            ] {
                assert_eq!(
                    parse(&format!("qualitylayer://{area}/{section}")),
                    Link::Home
                );
            }
            assert_eq!(
                parse(&format!("qualitylayer://{area}/{}", "x".repeat(201))),
                Link::Home
            );
        }
    }

    #[test]
    fn task_and_project_artifact_hashes_keep_their_encoded_document() {
        for link in [
            "qualitylayer://task/repo~task/artifacts%2Fwelcome.html",
            "qualitylayer://task/repo~task/artifacts%2fwelcome.html/heading",
            "qualitylayer://team/t_9c2/artifacts%2Fwelcome.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2Fwelcome.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome%2Fsecret.html",
            "qualitylayer://task/repo/artifacts%2Fflow%2FStep_2.html",
            "qualitylayer://task/repo/artifacts%2Fflow%2Fstep.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2Fflow%2FStep_2.html",
            "qualitylayer://artifact/repo/.qualitylayer%2Fartifacts%2Fapp-model%2Fhome.html",
        ] {
            assert_eq!(parse(link), route(link), "{link}");
        }
    }

    #[test]
    fn artifact_links_refuse_unknown_escapes_traversal_and_extra_segments() {
        for link in [
            "qualitylayer://task/repo/artifacts%2F..%2Fsecret.html",
            "qualitylayer://task/repo/artifact%252Fwelcome.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome%00.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome%2Ehtml",
            "qualitylayer://task/repo/artifacts%2Fwelcome%5Csecret.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome.html%2Fsecret.html",
            "qualitylayer://task/repo/artifacts%2Fflow%2F..%2Fsecret.html",
            "qualitylayer://task/repo/artifacts%2Fflow%2F%2e%2e.html",
            "qualitylayer://task/repo/.qualitylayer%2Fartifacts%2Fapp-model%2Fhome.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome.html?token=1",
            "qualitylayer://task/repo/artifacts%2Fwelcome.html%3Ftoken%3Dsecret",
            "qualitylayer://task/repo/artifacts%2Fwelcome.html#/task/other",
            "qualitylayer://task/repo/artifacts%2Fwelcome.html%23other",
            "qualitylayer://task/repo/artifacts/welcome.html",
            "qualitylayer://task/repo/artifacts/welcome.html",
            "qualitylayer://task/repo/private%2Fwelcome.html",
            "qualitylayer://task/repo/docs%2Fartifacts%2Fwelcome.html",
            "qualitylayer://task/repo/artifacts%2Fwelcome.md",
            "qualitylayer://task/repo/artifacts%2F.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2F..%2Fsecret.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2F%2e%2e.html",
            "qualitylayer://artifact/repo/docs/artifacts/welcome.html",
            "qualitylayer://artifact/repo/docs%252Fartifacts%252Fwelcome.html",
            "qualitylayer://artifact/repo/docs%252Fartifacts%252Fflow%252Fstep.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2Fflow%2Fstep.html%3Ftoken=x",
            "qualitylayer://artifact/repo/.qualitylayer%2Fartifacts%2Fhome.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2Fwelcome%00.html",
            "qualitylayer://artifact/repo/docs%2Fartifacts%2Fwelcome.html/extra/too-many",
            "qualitylayer://artifact/repo/private%2Fsecret.html",
            "qualitylayer://artifact/repo/artifacts%2Fwelcome.html",
            "qualitylayer://artifact/repo/welcome.html",
            "qualitylayer://artifact/%2e%2e/docs%2Fartifacts%2Fwelcome.html",
            "qualitylayer://step/t_9c2/deploy",
            "qualitylayer://step/t_9c2/discuss",
            "qualitylayer://step/t_9c2/research",
            "qualitylayer://step/t_9c2/outline",
            "qualitylayer://step/t_9c2/review",
            "qualitylayer://foreign.test/task/x",
            "qualitylayer://task@foreign.test/x",
        ] {
            assert_eq!(parse(link), Link::Home, "{link}");
        }
    }

    #[test]
    fn encoded_artifact_files_keep_the_existing_segment_bound() {
        let task_file = format!(
            "artifacts%2F{}.html",
            "x".repeat(MAX_SEGMENT - "artifacts%2F".len() - ".html".len())
        );
        let project_file = format!("docs%2Fartifacts%2F{}.html", "x".repeat(96));
        let folder_file = format!("docs%2Fartifacts%2Fflow%2F{}.html", "x".repeat(89));
        assert_eq!(task_file.len(), MAX_SEGMENT);
        assert_eq!(project_file.len(), MAX_SEGMENT);
        assert_eq!(folder_file.len(), MAX_SEGMENT);
        for link in [
            format!("qualitylayer://task/repo/{task_file}"),
            format!("qualitylayer://artifact/repo/{project_file}"),
            format!("qualitylayer://artifact/repo/{folder_file}"),
        ] {
            assert_eq!(parse(&link), route(&link));
            assert_eq!(parse(&link.replace(".html", "x.html")), Link::Home);
        }
    }

    #[test]
    fn anything_but_a_plain_place_is_home() {
        let long = "x".repeat(MAX_SEGMENT + 1);
        for link in [
            "qualitylayer://task/x?token=1",
            "qualitylayer://task/x#/other",
            "qualitylayer://task/x/../y",
            "qualitylayer://task/..",
            "qualitylayer://task/%2e%2e",
            "qualitylayer://task/a b",
            "qualitylayer://task/x/y/z/w",
            "qualitylayer://ask/only-one",
            "qualitylayer://ask/t/a/extra",
            "qualitylayer://step/only-one",
            "qualitylayer://step/t/verify/extra",
            "qualitylayer://team",
            "qualitylayer://run/anything",
            "qualitylayer://",
            "qualitylayer://update/now",
            "https://qualitylayer.dev/open/task/x",
            "qualitylayer:task/x",
            "",
            &format!("qualitylayer://task/{long}"),
        ] {
            assert_eq!(parse(link), Link::Home, "{link}");
        }
        // The longest segment still passes: the limit is the contract's, not one less.
        let longest = "x".repeat(MAX_SEGMENT);
        assert_eq!(
            parse(&format!("qualitylayer://task/{longest}")),
            Link::Route(format!("#/task/{longest}"))
        );
    }
}
