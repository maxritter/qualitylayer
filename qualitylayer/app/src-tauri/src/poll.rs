//! The tray's eyes. Once a minute the App asks its local server for the task list, the notification
//! switches and the notification rows (over loopback, with the key `app ensure` returned), compares
//! each answer with the last one, and says what is new, and only what a person can act on: a Plan or
//! a review that waits, a task that stopped or shipped, a question or a need of the agent. Agent
//! progress never notifies. These polls count as activity, which keeps the server up while the App
//! runs.

#[path = "poll_gates.rs"]
mod gates;
#[path = "poll_http.rs"]
mod http;
#[path = "poll_live.rs"]
mod live;
#[path = "poll_log.rs"]
mod log;

use gates::{open_gates, shipped, stops, Gate};
pub use http::{get, Failed};
pub use log::{record, remember, should_announce};

use serde_json::Value;
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::fs;
#[cfg(test)]
use std::io::{Read, Write};
use std::time::Duration;

/// How often the tray looks.
pub const INTERVAL: Duration = Duration::from_secs(60);
/// The local server and the key that opens it.
#[derive(Clone)]
pub struct Server {
    pub port: u16,
    pub token: String,
}

/// Which of Settings › Notifications' two switches a notice belongs to: what needs the person, or a
/// task that shipped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Switch {
    NeedsYou,
    Finished,
}

/// Something to tell the person: a native notification that opens the App at `route`.
#[derive(Clone, Debug, PartialEq)]
pub struct Notice {
    pub key: String,
    pub title: String,
    pub body: String,
    pub route: String,
    pub switch: Switch,
}

/// The notification switches of Settings, as the server's config holds them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
    pub needs_you: bool,
    pub finished: bool,
}

impl Default for Settings {
    /// What the server's config starts with: both on.
    fn default() -> Self {
        Settings {
            needs_you: true,
            finished: true,
        }
    }
}

impl Settings {
    /// From `GET /api/config`; a switch the answer does not name is on, as the config's default is.
    pub fn from_config(reply: &Value) -> Self {
        let switch = |name: &str| {
            reply["config"]["notifications"][name]
                .as_bool()
                .unwrap_or(true)
        };
        Settings {
            needs_you: switch("gateOpened"),
            finished: switch("taskFinished"),
        }
    }

    /// Only the notices whose switch is on.
    pub fn filter(&self, news: Vec<Notice>) -> Vec<Notice> {
        news.into_iter()
            .filter(|notice| match notice.switch {
                Switch::NeedsYou => self.needs_you,
                Switch::Finished => self.finished,
            })
            .collect()
    }
}

/// One thing that waits for the person, as the tray menu names it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Waiting {
    pub text: String,
    pub route: String,
}

/// What the person has to do now: a line for every Plan, review or stop that waits.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Summary {
    pub waiting: Vec<Waiting>,
}

/// The keys of what the polls saw last, for one kind of event. A kind that has not been read yet
/// (the first poll, or an answer that failed) tells nothing: its first good read only fills it.
#[derive(Default)]
struct Tracker(Option<HashSet<String>>);

impl Tracker {
    /// Take this look: `all` is every key there is, and `events` the ones to tell about. Returns the
    /// events whose key the last look did not have.
    fn observe(&mut self, all: HashSet<String>, events: Vec<(String, Notice)>) -> Vec<Notice> {
        let before = self.0.replace(all);
        let Some(before) = before else {
            return Vec::new();
        };
        events
            .into_iter()
            .filter(|(key, _)| !before.contains(key))
            .map(|(_, notice)| notice)
            .collect()
    }
}

/// What the polls saw last.
#[derive(Default)]
pub struct Seen {
    live: Tracker,
    gates: Tracker,
    stops: Tracker,
    shipped: Tracker,
    /// The last switches the server told: a look that cannot read them keeps these.
    settings: Settings,
    /// What each machine of this computer's list was last seen with, by id: the first look at a machine
    /// only learns what is there, and a machine that fails a round keeps what it had.
    machines: HashMap<String, Seen>,
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

/// The place in the App a link to this path opens; the link parser keeps the rules for what a
/// place may be called, so a name it refuses opens the home page.
fn route(path: &str) -> String {
    match crate::links::parse(&format!("qualitylayer://{path}")) {
        crate::links::Link::Route(hash) => hash,
        _ => String::new(),
    }
}

/// How many items wait, in the step line's words, for a body that goes on with `before`.
fn items_waiting(count: Option<u64>, before: &str) -> Option<String> {
    match count {
        Some(0) | None => None,
        Some(1) => Some(format!("1 item needs you {before}.")),
        Some(many) => Some(format!("{many} items need you {before}.")),
    }
}

/// The task's name, for a title.
fn name(task: &Value) -> &str {
    match text(task, "title") {
        "" => "A task",
        title => title,
    }
}

impl Seen {
    /// Local questions and needs use the page's keys, including a whole question batch. A task's first
    /// question is `front`: on this computer the CLI's launcher brings the App forward and tells it,
    /// so it is left out; a machine's launcher has no screen for the person, so `from_machine` tells
    /// it here, as the machine's page does in its frame (the same key, so it is told once).
    pub fn compare_live(
        &mut self,
        tasks: &Value,
        notifications: Option<&Value>,
        from_machine: bool,
    ) -> Vec<Notice> {
        let events = live::collect_live_events(tasks, notifications, from_machine);
        let all = events.iter().map(|n| n.key.clone()).collect();
        self.live.observe(
            all,
            events.into_iter().map(|n| (n.key.clone(), n)).collect(),
        )
    }
    /// Hold back what the person's switches silence. `config` is the server's answer to this look;
    /// when it did not come (the server was busy, or answered with an error) the last switches
    /// that did come stand, so a person who turned notifications off never gets one by accident.
    /// Before any answer both are on, as the config starts.
    pub fn silence(&mut self, config: Option<&Value>, news: Vec<Notice>) -> Vec<Notice> {
        if let Some(config) = config {
            self.settings = Settings::from_config(config);
        }
        self.settings.filter(news)
    }

    /// Compare this poll's answers with the last. `None` is an answer that did not come: what was
    /// seen stays. Returns everything that is new, whatever the switches say (a switch that is off
    /// must not hold events back and tell them when it goes on), and what waits now.
    pub fn compare(&mut self, tasks: Option<&Value>) -> (Vec<Notice>, Summary) {
        let mut news = Vec::new();
        let mut summary = Summary::default();
        if let Some(tasks) = tasks {
            let gates = open_gates(tasks);
            let stopped = stops(tasks);
            summary.waiting = gates
                .iter()
                .map(|gate| gate.line.clone())
                .chain(stopped.iter().map(|stop| stop.line.clone()))
                .collect();
            let keys = |keys: Vec<&String>| keys.into_iter().cloned().collect::<HashSet<_>>();
            // A gate that is locked is not told about, and not remembered: when it unlocks, it is.
            let ready: Vec<Gate> = gates.into_iter().filter(|gate| !gate.locked).collect();
            let gate_keys = keys(ready.iter().map(|gate| &gate.key).collect());
            news.extend(
                self.gates.observe(
                    gate_keys,
                    ready
                        .into_iter()
                        .map(|gate| (gate.key, gate.notice))
                        .collect(),
                ),
            );
            let stop_keys = keys(stopped.iter().map(|stop| &stop.key).collect());
            news.extend(
                self.stops.observe(
                    stop_keys,
                    stopped
                        .into_iter()
                        .map(|stop| (stop.key, stop.notice))
                        .collect(),
                ),
            );
            let (all, events) = shipped(tasks);
            news.extend(self.shipped.observe(all, events));
        }
        (news, summary)
    }
}

/// One look at one server: its tasks, its switches and its notification rows. `None` when no server
/// answered the first read (nothing is said, and what was seen stays).
fn look(server: &Server, seen: &mut Seen, from_machine: bool) -> Option<(Vec<Notice>, Summary)> {
    let tasks = match get(server, "/api/tasks") {
        Ok(tasks) => Some(tasks),
        Err(Failed::Down) => return None,
        Err(Failed::Status(_)) => None,
    };
    // The person's switches in Settings, read each time so a change holds from the next look on.
    let config = get(server, "/api/config").ok();
    let (news, summary) = seen.compare(tasks.as_ref());
    let mut news = news;
    if let Some(tasks) = tasks.as_ref() {
        let notifications = get(server, "/api/interaction/shell/notifications").ok();
        news.extend(seen.compare_live(tasks, notifications.as_ref(), from_machine));
    }
    Some((seen.silence(config.as_ref(), news), summary))
}

/// A machine of this computer's list that is connected: its name, and the port of this computer its
/// page and API are served on.
struct Machine {
    id: String,
    name: String,
    port: Option<u16>,
}

/// The machines `GET /api/machines` lists. A name the links refuse cannot be a machine's place, so it is
/// no machine here; a machine is read only while it is connected (the list gives a port then).
fn machines_of(reply: &Value) -> Vec<Machine> {
    reply["machines"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|machine| {
            let id = text(machine, "id");
            if !matches!(
                crate::links::parse(&format!("qualitylayer://machine/{id}")),
                crate::links::Link::Route(_)
            ) {
                return None;
            }
            let name = match text(machine, "name") {
                "" => id,
                name => name,
            };
            Some(Machine {
                id: id.to_string(),
                name: name.to_string(),
                port: (text(machine, "state") == "connected")
                    .then(|| machine["port"].as_u64().and_then(|p| u16::try_from(p).ok()))
                    .flatten(),
            })
        })
        .collect()
}

/// A route of the machine's page as a route on that machine: `#/task/a` is `#/machine/<id>/task/a`.
fn on_machine(id: &str, route: &str) -> String {
    let place = route.strip_prefix("#/").unwrap_or("");
    self::route(&format!("machine/{id}/{place}"))
}

/// A machine's notice as this computer tells it: the machine's name in front, its id on the key (so
/// two machines' moments never meet, and the page's own notice of the same moment is the same one) and
/// a route on that machine.
fn of_machine(machine: &Machine, notice: Notice) -> Notice {
    Notice {
        key: format!("{}|{}", machine.id, notice.key),
        title: format!("{}: {}", machine.name, notice.title),
        route: on_machine(&machine.id, &notice.route),
        ..notice
    }
}

/// A line of the tray about a machine: "gpu-box · Billing: the Plan waits for you".
fn line_of_machine(machine: &Machine, line: &Waiting) -> Waiting {
    Waiting {
        text: format!("{} \u{b7} {}", machine.name, line.text),
        route: on_machine(&machine.id, &line.route),
    }
}

/// One round: read both lists. A server that is gone is not started here (the watch in
/// `liveness.rs` does that, and hands the new one over): the round reads nothing and returns none
/// until it has one. Returns the server to use next time: the same one after a failed read, until
/// the watch hands over another.
///
/// Then each connected machine of this computer's list is read the same way through its port on this
/// computer, with this computer's key: three reads each, in this same thread and this same minute, no
/// timer of their own. A machine that does not answer is skipped and keeps what it had seen; one that
/// left the list is forgotten.
pub fn round(
    server: Option<Server>,
    seen: &mut Seen,
) -> (Option<Server>, Vec<Notice>, Option<Summary>) {
    let Some(current) = server else {
        return (None, Vec::new(), None);
    };
    // The reference stays when nothing answers: a timeout or a torn answer from a server that is
    // still the same process would otherwise stop the poll for good, since the watch hands over a new
    // reference only after the process is gone. The next round reads it again.
    let Some((mut news, mut summary)) = look(&current, seen, false) else {
        return (Some(current), Vec::new(), None);
    };
    if let Ok(reply) = get(&current, "/api/machines") {
        let machines = machines_of(&reply);
        seen.machines
            .retain(|id, _| machines.iter().any(|machine| &machine.id == id));
        for machine in &machines {
            let Some(port) = machine.port else {
                continue;
            };
            let theirs = Server {
                port,
                token: current.token.clone(),
            };
            let held = seen.machines.entry(machine.id.clone()).or_default();
            let Some((told, lines)) = look(&theirs, held, true) else {
                continue;
            };
            news.extend(told.into_iter().map(|notice| of_machine(machine, notice)));
            summary.waiting.extend(
                lines
                    .waiting
                    .iter()
                    .map(|line| line_of_machine(machine, line)),
            );
        }
    }
    (Some(current), news, Some(summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_questions_batches_and_needs_use_the_pages_moment_keys() {
        let mut seen = Seen::default();
        assert!(seen.compare_live(&tasks_of(vec![]), None, false).is_empty());
        let question = json!({"id":"p~a","title":"Version output","stage":"plan","gate":null,"live":{"question":{"number":2,"text":"Choose output","front":false},"needs":[]}});
        let mut need = at("p~b", "implement", json!(null));
        need["live"] = json!({"question":null,"needs":[{"for":"T3","what":"Test key","state":"open","opened":7,"waiting":null}]});
        let tasks = tasks_of(vec![question, need]);
        let notices = seen.compare_live(&tasks, None, false);
        assert_eq!(
            notices.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
            vec!["p~a|question|2", "p~b|need|T3|7"]
        );
        assert!(seen.compare_live(&tasks, None, false).is_empty());
        let rows = json!({"notifications":[{"batch":"p~a|b1","state":"open","text":"Choose output","target":{"taskId":"p~a","itemId":"q1"}},{"batch":"p~a|b1","state":"open","text":"Choose color","target":{"taskId":"p~a","itemId":"q2"}}]});
        let notices = seen.compare_live(&tasks, Some(&rows), false);
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].key, "p~a|batch|b1");
        let mut lagging = Seen::default();
        let empty = json!({"notifications":[]});
        lagging.compare_live(&tasks_of(vec![]), Some(&empty), false);
        let notices = lagging.compare_live(&tasks, Some(&empty), false);
        assert_eq!(
            notices.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
            vec!["p~b|need|T3|7"]
        );
        assert_eq!(
            lagging.compare_live(&tasks, Some(&rows), false)[0].key,
            "p~a|batch|b1"
        );
    }
    #[test]
    fn a_focused_window_and_an_already_announced_moment_never_notify_again() {
        let home = std::env::temp_dir().join(format!("ql-notified-{}", std::process::id()));
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("notified.json"), r#"["task|question|2"]"#).unwrap();
        assert!(!should_announce(&home, "task|question|3", true));
        assert!(!should_announce(&home, "task|question|2", false));
        assert!(should_announce(&home, "task|question|3", false));
        assert!(!should_announce(&home, "task|question|3", false));
        fs::remove_dir_all(home).unwrap();
    }
    use serde_json::json;
    use std::net::TcpListener;

    const PLAN: &str = "01-plan.md";

    /// A task on the server's list with a pending gate on `target`.
    fn task(id: &str, target: &str, opened: u64) -> Value {
        json!({
            "id": id, "title": "Settings cleanup", "projectName": "pilot-shell",
            "stage": if target == "final" { "verify" } else { "plan" },
            "archived": false, "action": if target == "final" { "final" } else { "review" },
            "gate": { "id": "g1", "target": target, "opened": opened, "decision": "pending", "settled": false }
        })
    }

    /// A task with no gate, at `stage` (and the `action` the server names for it).
    fn at(id: &str, stage: &str, action: Value) -> Value {
        json!({
            "id": id, "title": "Settings cleanup", "projectName": "pilot-shell",
            "stage": stage, "archived": false, "action": action, "gate": null,
            "checkpoint": null, "closing": null
        })
    }

    fn tasks_of(list: Vec<Value>) -> Value {
        json!({ "tasks": list })
    }

    fn titles(news: &[Notice]) -> Vec<&str> {
        news.iter().map(|n| n.title.as_str()).collect()
    }

    #[test]
    fn a_plan_that_waits_and_a_review_that_waits_each_notify_once_in_the_step_lines_words() {
        let mut seen = Seen::default();
        // The first look only learns what already waits.
        let (news, _) = seen.compare(Some(&tasks_of(vec![])));
        assert!(news.is_empty());
        assert!(seen.compare(Some(&tasks_of(vec![]))).0.is_empty());

        let mut plan = task("p~a", PLAN, 1);
        plan["openItems"] = json!(4);
        let mut review = task("p~b", "final", 2);
        review["openItems"] = json!(1);
        let (news, _) = seen.compare(Some(&tasks_of(vec![plan.clone(), review.clone()])));
        assert_eq!(
            news,
            vec![
                Notice {
                    key: "p~a|g1|1".into(),
                    title: "Settings cleanup: Plan ready".into(),
                    body: "4 items need you before the build starts.".into(),
                    route: "#/task/p~a/01-plan.md".into(),
                    switch: Switch::NeedsYou,
                },
                Notice {
                    key: "p~b|g1|2".into(),
                    title: "Settings cleanup needs your review".into(),
                    body: "1 item needs you before it ships.".into(),
                    route: "#/task/p~b".into(),
                    switch: Switch::NeedsYou,
                },
            ]
        );
        assert!(seen
            .compare(Some(&tasks_of(vec![plan, review])))
            .0
            .is_empty());
    }

    #[test]
    fn a_gate_without_a_count_still_says_what_to_do() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![])));
        let (news, _) = seen.compare(Some(&tasks_of(vec![
            task("p~a", PLAN, 1),
            task("p~b", "final", 2),
        ])));
        assert_eq!(news[0].body, "Read the Plan and approve it.");
        assert_eq!(news[1].body, "The change is ready for your review.");
    }

    #[test]
    fn a_gate_that_opens_again_notifies_again() {
        let mut seen = Seen::default();
        let open = tasks_of(vec![task("p~a", PLAN, 1)]);
        seen.compare(Some(&open));
        seen.compare(Some(&tasks_of(vec![])));
        let again = tasks_of(vec![task("p~a", PLAN, 9)]);
        assert_eq!(seen.compare(Some(&again)).0.len(), 1);
    }

    #[test]
    fn a_plan_whose_approval_is_still_locked_notifies_when_it_unlocks_not_before() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![])));
        let mut locked = task("p~a", PLAN, 1);
        locked["gate"]["locked"] = json!("Waiting for the second opinion");
        let (news, summary) = seen.compare(Some(&tasks_of(vec![locked.clone()])));
        assert!(news.is_empty());
        // It still waits for the person to read it, and the tray says so.
        assert_eq!(
            summary.waiting[0].text,
            "Settings cleanup: the Plan waits for you"
        );
        assert!(seen.compare(Some(&tasks_of(vec![locked]))).0.is_empty());

        let mut open = task("p~a", PLAN, 1);
        open["gate"]["locked"] = json!(null);
        let (news, _) = seen.compare(Some(&tasks_of(vec![open.clone()])));
        assert_eq!(titles(&news), vec!["Settings cleanup: Plan ready"]);
        assert!(seen.compare(Some(&tasks_of(vec![open]))).0.is_empty());
    }

    #[test]
    fn a_task_that_stops_notifies_once_for_each_way_it_stops_and_a_stop_gate_is_not_also_a_review()
    {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![at("p~a", "implement", json!(null))])));
        let mut build = at("p~a", "capped", json!("build"));
        build["checkpoint"] = json!(2);
        let (news, summary) = seen.compare(Some(&tasks_of(vec![build.clone()])));
        assert_eq!(titles(&news), vec!["Settings cleanup stopped"]);
        assert_eq!(
            news[0].body,
            "A checkpoint failed twice. Choose how to go on."
        );
        assert_eq!(news[0].route, "#/task/p~a");
        assert_eq!(
            summary.waiting[0].text,
            "Settings cleanup: stopped, waits for you"
        );
        assert!(seen.compare(Some(&tasks_of(vec![build]))).0.is_empty());

        // The checks that ran twice and did not settle.
        let capped = at("p~a", "capped", json!("capped"));
        let (news, _) = seen.compare(Some(&tasks_of(vec![capped])));
        assert_eq!(titles(&news), vec!["Settings cleanup stopped"]);
        assert_eq!(
            news[0].body,
            "Checking ran twice without settling. Choose how to go on."
        );

        // A stop that the agent opened as its own gate: one notice, and no review line beside it.
        let mut stop = at("p~b", "implement", json!(null));
        stop["gate"] = json!({ "id": "s1", "kind": "stop", "target": "build", "opened": 5, "decision": "pending", "settled": false });
        let (news, summary) = seen.compare(Some(&tasks_of(vec![stop])));
        assert_eq!(titles(&news), vec!["Settings cleanup stopped"]);
        assert_eq!(summary.waiting.len(), 1);
        assert_eq!(
            summary.waiting[0].text,
            "Settings cleanup: stopped, waits for you"
        );
    }

    #[test]
    fn an_amend_hold_is_not_a_review_and_notifies_nothing() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![at("p~c", "implement", json!(null))])));
        let mut amend = at("p~c", "implement", json!(null));
        amend["gate"] = json!({ "id": "a1", "kind": "amend", "target": "01-plan.md", "opened": 7, "decision": "pending", "settled": false });
        let (news, summary) = seen.compare(Some(&tasks_of(vec![amend])));
        assert!(news.is_empty());
        assert!(summary.waiting.is_empty());
    }

    #[test]
    fn a_task_that_ships_notifies_once_under_the_other_switch_and_an_archived_one_never() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![at("p~old", "shipped", json!(null))])));
        let mut shipped = at("p~a", "shipped", json!(null));
        shipped["closing"] =
            json!({ "shipped": "2026-10-04", "slices": 5, "firstPass": true, "touched": [] });
        let mut archived = at("p~z", "shipped", json!(null));
        archived["archived"] = json!(true);
        let list = tasks_of(vec![at("p~old", "shipped", json!(null)), shipped, archived]);
        let (news, _) = seen.compare(Some(&list));
        assert_eq!(
            news,
            vec![Notice {
                key: "p~a|shipped".into(),
                title: "Settings cleanup shipped".into(),
                body: "The change is done. 5 slices were built.".into(),
                route: "#/task/p~a".into(),
                switch: Switch::Finished,
            }]
        );
        assert!(seen.compare(Some(&list)).0.is_empty());
    }

    #[test]
    fn agent_progress_never_notifies() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![at("p~a", "plan", json!(null))])));
        for stage in ["plan", "implement", "verify"] {
            let mut running = at("p~a", stage, json!(null));
            running["helpers"] =
                json!([{ "id": "h1", "line": "writing a test", "state": "running" }]);
            running["progress"] = json!({ "total": 6, "checked": 3, "slices": 2 });
            assert!(
                seen.compare(Some(&tasks_of(vec![running]))).0.is_empty(),
                "{stage}"
            );
        }
        // The Implement start is the person's own move, right after approving: no notice either.
        let start = at("p~a", "implement", json!("implement"));
        assert!(seen.compare(Some(&tasks_of(vec![start]))).0.is_empty());
    }

    #[test]
    fn an_answer_that_did_not_come_keeps_what_was_seen() {
        let mut seen = Seen::default();
        let tasks = tasks_of(vec![task("p~a", PLAN, 1)]);
        seen.compare(Some(&tasks));
        // The task list fails for a while; later it works again with the same Plan: nothing is new.
        seen.compare(None);
        assert!(seen.compare(Some(&tasks)).0.is_empty());
    }

    #[test]
    fn a_name_the_links_refuse_opens_the_home_page_not_a_made_up_place() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![task("../etc", PLAN, 1)])));
        let again = tasks_of(vec![task("../etc", PLAN, 1), task("p~b", PLAN, 2)]);
        let (news, _) = seen.compare(Some(&again));
        assert_eq!(news[0].route, "#/task/p~b/01-plan.md");
        let hostile = tasks_of(vec![
            task("../etc", PLAN, 1),
            task("p~b", PLAN, 2),
            task("x?token=1", PLAN, 3),
        ]);
        assert_eq!(seen.compare(Some(&hostile)).0[0].route, "");
    }

    #[test]
    fn the_switches_silence_what_they_cover_and_what_happened_meanwhile_is_not_told_later() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![])));
        let plan = tasks_of(vec![
            task("p~a", PLAN, 1),
            at("p~s", "shipped", json!(null)),
        ]);
        let (news, _) = seen.compare(Some(&plan));
        assert_eq!(news.len(), 2);

        let off = Settings {
            needs_you: false,
            finished: false,
        };
        assert!(off.filter(news.clone()).is_empty(), "off silences all");
        let finished_only = Settings {
            needs_you: false,
            finished: true,
        };
        assert_eq!(
            titles(&finished_only.filter(news.clone())),
            vec!["Settings cleanup shipped"]
        );
        assert_eq!(Settings::default().filter(news).len(), 2);
        // The poll still saw them: switching on later tells nothing about them.
        assert!(seen.compare(Some(&plan)).0.is_empty());
    }

    #[test]
    fn a_look_that_cannot_read_the_config_keeps_the_last_switches_it_had() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![])));
        let news = seen.compare(Some(&tasks_of(vec![task("p~a", PLAN, 1)]))).0;
        // Before any answer both are on, as the config starts.
        assert_eq!(seen.silence(None, news.clone()).len(), 1);
        // The person turns them off.
        let off = json!({ "config": { "notifications": { "gateOpened": false, "taskFinished": false } } });
        assert!(seen.silence(Some(&off), news.clone()).is_empty());
        // The server fails to answer the config for a while: still off, not on by default.
        assert!(seen.silence(None, news.clone()).is_empty());
        assert!(seen.silence(None, news.clone()).is_empty());
        let on =
            json!({ "config": { "notifications": { "gateOpened": true, "taskFinished": true } } });
        assert_eq!(seen.silence(Some(&on), news).len(), 1);
    }

    #[test]
    fn a_shipped_task_names_its_pull_request() {
        let mut seen = Seen::default();
        seen.compare(Some(&tasks_of(vec![])));
        let mut shipped = at("p~a", "shipped", json!(null));
        shipped["closing"] = json!({ "slices": 5, "pr": { "number": 412 } });
        let (news, _) = seen.compare(Some(&tasks_of(vec![shipped])));
        assert_eq!(news[0].body, "Pull request #412.");
    }

    #[test]
    fn the_switches_come_from_the_servers_config() {
        let both = json!({ "ok": true, "config": { "notifications": { "gateOpened": true, "taskFinished": false } } });
        assert_eq!(
            Settings::from_config(&both),
            Settings {
                needs_you: true,
                finished: false
            }
        );
        let off = json!({ "config": { "notifications": { "gateOpened": false, "taskFinished": false } } });
        assert_eq!(
            Settings::from_config(&off),
            Settings {
                needs_you: false,
                finished: false
            }
        );
        // A config that says nothing is the default: on.
        assert_eq!(
            Settings::from_config(&json!({ "ok": true })),
            Settings::default()
        );
        assert_eq!(
            Settings::default(),
            Settings {
                needs_you: true,
                finished: true
            }
        );
    }

    #[test]
    fn the_tray_says_what_waits_one_line_each() {
        let mut seen = Seen::default();
        let mut build = at("p~c", "capped", json!("build"));
        build["title"] = json!("Desktop app");
        let mut other = task("p~b", "final", 2);
        other["title"] = json!("Team gating");
        let tasks = tasks_of(vec![task("p~a", PLAN, 1), other, build]);
        let (_, summary) = seen.compare(Some(&tasks));
        let lines: Vec<&str> = summary.waiting.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(
            lines,
            vec![
                "Settings cleanup: the Plan waits for you",
                "Team gating: the review waits for you",
                "Desktop app: stopped, waits for you"
            ]
        );
        assert_eq!(summary.waiting[0].route, "#/task/p~a/01-plan.md");
    }

    #[test]
    fn nothing_waiting_leaves_the_summary_empty_and_archived_tasks_never_count() {
        let mut seen = Seen::default();
        let mut gone = task("p~a", PLAN, 1);
        gone["archived"] = json!(true);
        let (_, summary) = seen.compare(Some(&tasks_of(vec![gone])));
        assert_eq!(summary, Summary::default());
    }

    /// A server on a loopback port that answers one request with `answer` and returns what it got.
    fn serve_once(answer: &'static [u8]) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            stream.write_all(answer).unwrap();
            String::from_utf8(request).unwrap()
        });
        (port, handle)
    }

    #[test]
    fn a_read_carries_the_key_and_the_host_and_parses_the_answer() {
        let (port, got) = serve_once(
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 21\r\n\r\n{\"ok\":true,\"tasks\":1}",
        );
        let server = Server {
            port,
            token: "k3y".into(),
        };
        let reply = get(&server, "/api/tasks?archived=1").unwrap();
        assert_eq!(reply["tasks"], 1);
        let request = got.join().unwrap();
        assert!(request.starts_with("GET /api/tasks?archived=1 HTTP/1.1\r\n"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert!(request.contains("x-qualitylayer-token: k3y\r\n"));
    }

    #[test]
    fn one_failed_read_keeps_the_server_and_the_next_round_reads_it_again() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // The first answer is not HTTP at all; the four reads of the next round get a good one (the
        // fourth, the machines' list, finds no machine in `{"tasks":[]}`).
        std::thread::spawn(move || {
            for turn in 0..5 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = Vec::new();
                let mut byte = [0u8; 1];
                while !request.ends_with(b"\r\n\r\n") {
                    if stream.read_exact(&mut byte).is_err() {
                        break;
                    }
                    request.push(byte[0]);
                }
                let answer: &[u8] = if turn == 0 {
                    b"not http at all"
                } else {
                    b"HTTP/1.1 200 OK\r\ncontent-length: 12\r\nconnection: close\r\n\r\n{\"tasks\":[]}"
                };
                let _ = stream.write_all(answer);
            }
        });
        let mut seen = Seen::default();
        let server = Server {
            port,
            token: "k".into(),
        };
        let (kept, news, summary) = round(Some(server), &mut seen);
        assert!(news.is_empty());
        assert!(summary.is_none());
        let server =
            kept.expect("a failed read must not drop the server: no one hands another one over");
        assert_eq!(server.port, port);
        let (kept, _, summary) = round(Some(server), &mut seen);
        assert!(kept.is_some());
        assert!(summary.is_some(), "the next round reads the same server");
    }

    #[test]
    fn a_chunked_answer_is_read_whole() {
        let (port, _) = serve_once(
            b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n7\r\n{\"ok\":t\r\n5\r\nrue}\n\r\n0\r\n\r\n",
        );
        let reply = get(
            &Server {
                port,
                token: String::new(),
            },
            "/api/tasks",
        )
        .unwrap();
        assert_eq!(reply["ok"], true);
    }

    #[test]
    fn a_stopped_server_and_a_refused_key_both_call_for_the_cli_and_other_answers_do_not() {
        let closed = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let down = get(
            &Server {
                port: closed,
                token: String::new(),
            },
            "/api/tasks",
        );
        assert_eq!(down, Err(Failed::Down));

        let (port, _) = serve_once(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n");
        assert_eq!(
            get(
                &Server {
                    port,
                    token: "old".into()
                },
                "/api/tasks"
            ),
            Err(Failed::Down)
        );
        let (port, _) = serve_once(b"HTTP/1.1 402 Payment Required\r\ncontent-length: 0\r\n\r\n");
        assert_eq!(
            get(
                &Server {
                    port,
                    token: "k".into()
                },
                "/api/tasks"
            ),
            Err(Failed::Status(402))
        );
    }

    // ── machines ──

    /// A loopback server that answers each request by its path (without the query) from `routes`, and
    /// 404 for the rest. It remembers what it was asked and with which key, in order.
    struct Fake {
        port: u16,
        routes: Arc<Mutex<HashMap<String, Value>>>,
        asked: Arc<Mutex<Vec<(String, String)>>>,
    }

    impl Fake {
        fn start() -> Fake {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let routes: Arc<Mutex<HashMap<String, Value>>> = Arc::default();
            let asked: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
            let (mine, log) = (routes.clone(), asked.clone());
            std::thread::spawn(move || {
                while let Ok((mut stream, _)) = listener.accept() {
                    let mut request = Vec::new();
                    let mut byte = [0u8; 1];
                    while !request.ends_with(b"\r\n\r\n") {
                        if stream.read_exact(&mut byte).is_err() {
                            break;
                        }
                        request.push(byte[0]);
                    }
                    let head = String::from_utf8_lossy(&request).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                    let key = head
                        .lines()
                        .find_map(|line| line.strip_prefix("x-qualitylayer-token: "))
                        .unwrap_or("")
                        .to_string();
                    log.lock().unwrap().push((path.clone(), key));
                    let answer = mine
                        .lock()
                        .unwrap()
                        .get(path.split('?').next().unwrap_or(""))
                        .cloned();
                    let _ = match answer {
                        Some(body) => {
                            let body = body.to_string();
                            write!(
                                stream,
                                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                                body.len()
                            )
                        }
                        None => write!(
                            stream,
                            "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                        ),
                    };
                }
            });
            Fake {
                port,
                routes,
                asked,
            }
        }

        fn say(&self, path: &str, body: Value) {
            self.routes.lock().unwrap().insert(path.to_string(), body);
        }

        /// The paths asked since the last call, with the key each carried.
        fn asked(&self) -> Vec<(String, String)> {
            std::mem::take(&mut *self.asked.lock().unwrap())
        }
    }

    use std::sync::{Arc, Mutex};

    fn titled(id: &str, title: &str, target: &str, opened: u64) -> Value {
        let mut found = task(id, target, opened);
        found["title"] = json!(title);
        found
    }

    fn listed(machines: Vec<Value>) -> Value {
        json!({ "ok": true, "machines": machines })
    }

    fn connected(id: &str, port: u16) -> Value {
        json!({ "id": id, "name": id, "target": format!("max@{id}"), "state": "connected", "port": port })
    }

    fn offline(id: &str) -> Value {
        json!({ "id": id, "name": id, "target": format!("max@{id}"), "state": "offline" })
    }

    fn this_computer(machines: Vec<Value>) -> Fake {
        let this = Fake::start();
        this.say("/api/tasks", tasks_of(vec![]));
        this.say("/api/machines", listed(machines));
        this
    }

    fn server_of(fake: &Fake) -> Server {
        Server {
            port: fake.port,
            token: "ours".into(),
        }
    }

    #[test]
    fn a_round_names_each_machine_in_its_lines_and_notices_and_routes_them_to_that_machine() {
        let machine = Fake::start();
        machine.say(
            "/api/tasks",
            tasks_of(vec![titled("p~billing", "Billing", PLAN, 1)]),
        );
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();

        // The first look at a machine tells nothing, as for this computer; its lines are there.
        let (kept, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(kept.is_some());
        assert!(news.is_empty());
        let lines = summary.unwrap().waiting;
        assert_eq!(
            lines,
            vec![Waiting {
                text: "gpu-box \u{b7} Billing: the Plan waits for you".into(),
                route: "#/machine/gpu-box/task/p~billing/01-plan.md".into(),
            }]
        );

        // A second Plan waits there: told with the machine's name, its id on the key and its route.
        machine.say(
            "/api/tasks",
            tasks_of(vec![
                titled("p~billing", "Billing", PLAN, 1),
                titled("p~gpu", "GPU queue", PLAN, 2),
            ]),
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert_eq!(
            news,
            vec![Notice {
                key: "gpu-box|p~gpu|g1|2".into(),
                title: "gpu-box: GPU queue: Plan ready".into(),
                body: "Read the Plan and approve it.".into(),
                route: "#/machine/gpu-box/task/p~gpu/01-plan.md".into(),
                switch: Switch::NeedsYou,
            }]
        );
    }

    #[test]
    fn a_machine_is_read_through_its_port_with_this_computers_key_in_three_requests_a_round() {
        let (first, second) = (Fake::start(), Fake::start());
        first.say("/api/tasks", tasks_of(vec![]));
        second.say("/api/tasks", tasks_of(vec![]));
        let this = this_computer(vec![
            connected("gpu-box", first.port),
            offline("build-vm"),
            connected("lab", second.port),
        ]);
        let mut seen = Seen::default();

        round(Some(server_of(&this)), &mut seen);

        fn paths(asked: &[(String, String)]) -> Vec<&str> {
            asked.iter().map(|(path, _)| path.as_str()).collect()
        }
        let (ours, theirs) = (this.asked(), first.asked());
        // This computer: its three reads, then the list of machines.
        assert_eq!(
            paths(&ours),
            vec![
                "/api/tasks",
                "/api/config",
                "/api/interaction/shell/notifications",
                "/api/machines"
            ]
        );
        // A connected machine: the same three, at its own port, with this computer's key. A machine
        // that is not connected is not asked.
        assert_eq!(paths(&theirs), paths(&ours)[..3].to_vec());
        assert!(theirs.iter().all(|(_, key)| key == "ours"));
        assert_eq!(second.asked().len(), 3);
        // With N machines a round is 3 + 1 + 3N requests; one thread, no timer of its own.
        assert_eq!(ours.len() + theirs.len() + 3, 3 + 1 + 3 * 2);
    }

    #[test]
    fn a_machine_that_does_not_answer_is_skipped_and_keeps_what_it_had_seen() {
        let machine = Fake::start();
        let plan = |opened: u64, id: &str| titled(id, "Billing", PLAN, opened);
        machine.say("/api/tasks", tasks_of(vec![plan(1, "p~one")]));
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);

        // It drops out of the list (offline): no line, nothing told, nothing forgotten.
        this.say("/api/machines", listed(vec![offline("gpu-box")]));
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());
        assert!(summary.unwrap().waiting.is_empty());

        // It is listed as connected at a port nobody answers: skipped too.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        this.say("/api/machines", listed(vec![connected("gpu-box", closed)]));
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());
        assert!(summary.unwrap().waiting.is_empty());

        // Back, with the old Plan and a new one: only the new one is told.
        machine.say(
            "/api/tasks",
            tasks_of(vec![plan(1, "p~one"), plan(2, "p~two")]),
        );
        this.say(
            "/api/machines",
            listed(vec![connected("gpu-box", machine.port)]),
        );
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert_eq!(
            news.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
            vec!["gpu-box|p~two|g1|2"]
        );
        assert_eq!(summary.unwrap().waiting.len(), 2);
    }

    #[test]
    fn a_machine_that_left_the_list_is_forgotten_and_its_return_is_a_first_look() {
        let machine = Fake::start();
        machine.say(
            "/api/tasks",
            tasks_of(vec![titled("p~one", "Billing", PLAN, 1)]),
        );
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);

        this.say("/api/machines", listed(vec![]));
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());
        assert!(summary.unwrap().waiting.is_empty());
        assert!(seen.machines.is_empty());

        this.say(
            "/api/machines",
            listed(vec![connected("gpu-box", machine.port)]),
        );
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty(), "the first look at a machine tells nothing");
        assert_eq!(summary.unwrap().waiting.len(), 1);
    }

    #[test]
    fn a_machines_own_switches_silence_its_notices_and_this_computers_lines_come_first() {
        let machine = Fake::start();
        machine.say("/api/tasks", tasks_of(vec![]));
        machine.say(
            "/api/config",
            json!({ "config": { "notifications": { "gateOpened": false, "taskFinished": true } } }),
        );
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        this.say(
            "/api/tasks",
            tasks_of(vec![titled("p~mine", "Mine", PLAN, 1)]),
        );
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);

        machine.say(
            "/api/tasks",
            tasks_of(vec![titled("p~theirs", "Theirs", PLAN, 5)]),
        );
        let (_, news, summary) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty(), "the machine's Needs you switch is off");
        let lines: Vec<String> = summary
            .unwrap()
            .waiting
            .into_iter()
            .map(|w| w.text)
            .collect();
        assert_eq!(
            lines,
            vec![
                "Mine: the Plan waits for you".to_string(),
                "gpu-box \u{b7} Theirs: the Plan waits for you".to_string()
            ]
        );
    }

    /// A task of the Discuss step that waits on question `number`; `front` marks the first question.
    fn asking(id: &str, number: u64, front: bool) -> Value {
        json!({
            "id": id, "title": "The flag", "projectName": "pilot-shell", "stage": "plan",
            "archived": false, "action": null, "gate": null,
            "live": { "question": { "number": number, "text": "Which name?", "front": front }, "needs": [] }
        })
    }

    /// What the shell lists for such a question: in the Plan it is an item, `plan:question:<n>`.
    fn plan_row(id: &str, number: u64) -> Value {
        json!({ "notifications": [{
            "batch": null, "state": "open", "text": "The flag \u{b7} Which name?",
            "target": { "taskId": id, "itemId": format!("plan:question:{number}") }
        }] })
    }

    #[test]
    fn the_first_question_of_a_task_on_a_machine_is_told_with_the_machines_name_once() {
        // The machine's CLI marks question 1 `front` and tells it through a launcher on the machine,
        // which has no screen for the person: the poll tells it, as the page around it does.
        let machine = Fake::start();
        machine.say("/api/tasks", tasks_of(vec![]));
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());

        machine.say("/api/tasks", tasks_of(vec![asking("p~flag", 1, true)]));
        machine.say(
            "/api/interaction/shell/notifications",
            plan_row("p~flag", 1),
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert_eq!(
            news,
            vec![Notice {
                // The page's key for the moment, with the machine's id in front: told once.
                key: "gpu-box|p~flag|question|1".into(),
                title: "gpu-box: Question 1 for you".into(),
                body: "Which name?\nThe flag".into(),
                route: "#/machine/gpu-box/task/p~flag".into(),
                switch: Switch::NeedsYou,
            }]
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty(), "the same question is not told again");
    }

    #[test]
    fn the_first_question_of_a_task_on_this_computer_stays_the_launchers() {
        let this = this_computer(vec![]);
        this.say("/api/tasks", tasks_of(vec![]));
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);

        this.say("/api/tasks", tasks_of(vec![asking("p~flag", 1, true)]));
        this.say(
            "/api/interaction/shell/notifications",
            plan_row("p~flag", 1),
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());

        // A later question is told, once; the shell lists it as the Discuss item.
        this.say("/api/tasks", tasks_of(vec![asking("p~flag", 2, false)]));
        this.say(
            "/api/interaction/shell/notifications",
            plan_row("p~flag", 2),
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert_eq!(
            news.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
            vec!["p~flag|question|2"]
        );
    }

    #[test]
    fn a_question_the_shell_does_not_list_waits_for_its_row() {
        let machine = Fake::start();
        machine.say("/api/tasks", tasks_of(vec![]));
        machine.say(
            "/api/interaction/shell/notifications",
            json!({ "notifications": [] }),
        );
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);
        machine.say("/api/tasks", tasks_of(vec![asking("p~flag", 1, true)]));
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty(), "no row confirms it yet");
        machine.say(
            "/api/interaction/shell/notifications",
            plan_row("p~flag", 1),
        );
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert_eq!(news.len(), 1);
    }

    #[test]
    fn rows_that_cannot_be_read_leave_a_first_question_untold_for_the_batch_notice() {
        let machine = Fake::start();
        machine.say("/api/tasks", tasks_of(vec![]));
        let this = this_computer(vec![connected("gpu-box", machine.port)]);
        let mut seen = Seen::default();
        round(Some(server_of(&this)), &mut seen);
        // No notifications route answers: a first question may be a batch's, told as one.
        machine.say("/api/tasks", tasks_of(vec![asking("p~flag", 1, true)]));
        let (_, news, _) = round(Some(server_of(&this)), &mut seen);
        assert!(news.is_empty());
    }

    #[test]
    fn a_name_the_links_refuse_is_no_machine() {
        let reply = listed(vec![
            connected("gpu-box", 41940),
            connected("..", 41941),
            connected("a/b", 41942),
            connected("", 41943),
            json!({ "id": "build-vm", "state": "connecting" }),
        ]);
        let ids: Vec<(String, Option<u16>)> = machines_of(&reply)
            .into_iter()
            .map(|m| (m.id, m.port))
            .collect();
        assert_eq!(
            ids,
            vec![
                ("gpu-box".to_string(), Some(41940)),
                ("build-vm".to_string(), None)
            ]
        );
    }
}
