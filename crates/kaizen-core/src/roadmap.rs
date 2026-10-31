//! Roadmap graph work: prerequisite closures, study order, readiness, and the
//! layered-DAG ordering used to draw the math tree (the browser only wraps
//! layers into rows and converts to pixels).

use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub status: String,
    pub branch: Option<String>,
    pub level: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from_node_id: String,
    pub to_node_id: String,
    /// PREREQUISITE | APPLICATION
    pub kind: String,
}

fn prerequisite_parents(edges: &[Edge]) -> HashMap<&str, Vec<&str>> {
    let mut parents: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in edges.iter().filter(|e| e.kind == "PREREQUISITE") {
        parents.entry(e.to_node_id.as_str()).or_default().push(e.from_node_id.as_str());
    }
    parents
}

/// Every prerequisite ancestor of `target` plus the target itself, in a valid
/// topological study order (stable with respect to the node array order).
pub fn path_to_target<'a>(target: &str, nodes: &'a [Node], edges: &[Edge]) -> Vec<&'a Node> {
    let parents = prerequisite_parents(edges);
    let mut in_path: HashSet<&str> = HashSet::new();
    let mut stack = vec![target];
    while let Some(id) = stack.pop() {
        if !in_path.insert(id) {
            continue;
        }
        if let Some(ps) = parents.get(id) {
            stack.extend(ps.iter().copied());
        }
    }
    let mut indegree: HashMap<&str, usize> = in_path.iter().map(|id| (*id, 0)).collect();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in edges.iter().filter(|e| e.kind == "PREREQUISITE") {
        let (from, to) = (e.from_node_id.as_str(), e.to_node_id.as_str());
        if in_path.contains(from) && in_path.contains(to) {
            *indegree.entry(to).or_default() += 1;
            children.entry(from).or_default().push(to);
        }
    }
    let order_of: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
    let by_id: HashMap<&str, &Node> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut ready: Vec<&str> = in_path.iter().copied().filter(|id| indegree[id] == 0).collect();
    let rank = |id: &&str| order_of.get(id).copied().unwrap_or(0);
    ready.sort_by_key(rank);
    let mut out = Vec::new();
    while !ready.is_empty() {
        let id = ready.remove(0);
        if let Some(node) = by_id.get(id) {
            out.push(*node);
        }
        for child in children.get(id).map(Vec::as_slice).unwrap_or(&[]) {
            let d = indegree.get_mut(child).expect("child in path");
            *d -= 1;
            if *d == 0 {
                ready.push(child);
                ready.sort_by_key(rank);
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct PathProgress {
    pub total: usize,
    pub done: usize,
    pub pct: i64,
}

pub fn path_progress(target: &str, nodes: &[Node], edges: &[Edge]) -> PathProgress {
    let path = path_to_target(target, nodes, edges);
    let done = path.iter().filter(|n| n.status == "COMPLETED").count();
    PathProgress {
        total: path.len(),
        done,
        pct: if path.is_empty() { 0 } else { crate::util::js_round(done as f64 / path.len() as f64 * 100.0) as i64 },
    }
}

/// Not-started nodes whose whole prerequisite closure is completed.
pub fn ready_set(nodes: &[Node], edges: &[Edge]) -> HashSet<String> {
    let parents = prerequisite_parents(edges);
    let by_id: HashMap<&str, &Node> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut cache: HashMap<&str, bool> = HashMap::new();
    fn complete_up_to<'a>(
        id: &'a str,
        by_id: &HashMap<&'a str, &'a Node>,
        parents: &HashMap<&'a str, Vec<&'a str>>,
        cache: &mut HashMap<&'a str, bool>,
    ) -> bool {
        if let Some(v) = cache.get(id) {
            return *v;
        }
        cache.insert(id, false); // cycle guard
        let ok = by_id.get(id).is_some_and(|n| n.status == "COMPLETED")
            && parents.get(id).map(Vec::as_slice).unwrap_or(&[]).iter().all(|p| complete_up_to(p, by_id, parents, cache));
        cache.insert(id, ok);
        ok
    }
    nodes
        .iter()
        .filter(|n| n.status == "NOT_STARTED")
        .filter(|n| {
            parents
                .get(n.id.as_str())
                .map(Vec::as_slice)
                .unwrap_or(&[])
                .iter()
                .all(|p| complete_up_to(p, &by_id, &parents, &mut cache))
        })
        .map(|n| n.id.clone())
        .collect()
}

/// All prerequisite ancestors per node (for hover tracing in the UI).
pub fn ancestors(nodes: &[Node], edges: &[Edge]) -> HashMap<String, Vec<String>> {
    let parents = prerequisite_parents(edges);
    nodes
        .iter()
        .map(|n| {
            let mut seen: HashSet<&str> = HashSet::new();
            let mut stack: Vec<&str> = parents.get(n.id.as_str()).cloned().unwrap_or_default();
            while let Some(id) = stack.pop() {
                if seen.insert(id)
                    && let Some(ps) = parents.get(id)
                {
                    stack.extend(ps.iter().copied());
                }
            }
            let mut list: Vec<String> = seen.into_iter().map(str::to_string).collect();
            list.sort();
            (n.id.clone(), list)
        })
        .collect()
}

/// Layered DAG ordering: depth = longest prerequisite chain from a root;
/// rows start grouped by branch/title, then two parent-barycenter sweeps and
/// one child-barycenter sweep reduce edge crossings.
pub fn layers(nodes: &[&Node], edges: &[Edge]) -> Vec<Vec<String>> {
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let prereq: Vec<&Edge> = edges
        .iter()
        .filter(|e| e.kind == "PREREQUISITE" && ids.contains(e.from_node_id.as_str()) && ids.contains(e.to_node_id.as_str()))
        .collect();
    let mut parents: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &prereq {
        parents.entry(e.to_node_id.as_str()).or_default().push(e.from_node_id.as_str());
        children.entry(e.from_node_id.as_str()).or_default().push(e.to_node_id.as_str());
    }
    let mut indegree: HashMap<&str, usize> =
        nodes.iter().map(|n| (n.id.as_str(), parents.get(n.id.as_str()).map_or(0, Vec::len))).collect();
    let mut queue: VecDeque<&str> = nodes.iter().map(|n| n.id.as_str()).filter(|id| indegree[id] == 0).collect();
    let mut depth: HashMap<&str, usize> = queue.iter().map(|id| (*id, 0)).collect();
    while let Some(id) = queue.pop_front() {
        let d = depth.get(id).copied().unwrap_or(0);
        for child in children.get(id).cloned().unwrap_or_default() {
            let entry = depth.entry(child).or_insert(0);
            *entry = (*entry).max(d + 1);
            let deg = indegree.get_mut(child).expect("child");
            *deg -= 1;
            if *deg == 0 {
                queue.push_back(child);
            }
        }
    }
    let max_depth = depth.values().copied().max().unwrap_or(0);
    let mut layers: Vec<Vec<&str>> = vec![Vec::new(); max_depth + 1];
    let by_id: HashMap<&str, &Node> = nodes.iter().map(|n| (n.id.as_str(), *n)).collect();
    let mut sorted: Vec<&&Node> = nodes.iter().collect();
    sorted.sort_by(|a, b| {
        a.branch.as_deref().unwrap_or("").cmp(b.branch.as_deref().unwrap_or("")).then_with(|| a.title.cmp(&b.title))
    });
    for n in sorted {
        layers[depth.get(n.id.as_str()).copied().unwrap_or(0)].push(n.id.as_str());
    }

    let mut index: HashMap<&str, f64> = HashMap::new();
    fn reindex<'a>(layers: &[Vec<&'a str>], index: &mut HashMap<&'a str, f64>) {
        for layer in layers {
            for (i, id) in layer.iter().enumerate() {
                index.insert(*id, i as f64);
            }
        }
    }
    reindex(&layers, &mut index);
    for pass in 0..3 {
        let use_parents = pass != 1;
        let neighbors = if use_parents { &parents } else { &children };
        let order: Vec<usize> = if use_parents { (0..layers.len()).collect() } else { (0..layers.len()).rev().collect() };
        for li in order {
            let bary = |id: &str, index: &HashMap<&str, f64>| {
                let xs: Vec<f64> =
                    neighbors.get(id).map(|ns| ns.iter().filter_map(|n| index.get(n).copied()).collect()).unwrap_or_default();
                if xs.is_empty() { index[id] } else { xs.iter().sum::<f64>() / xs.len() as f64 }
            };
            let mut keyed: Vec<(f64, &str)> = layers[li].iter().map(|id| (bary(id, &index), *id)).collect();
            keyed.sort_by(|a, b| {
                a.0.partial_cmp(&b.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| by_id[a.1].title.cmp(&by_id[b.1].title))
            });
            layers[li] = keyed.into_iter().map(|(_, id)| id).collect();
            reindex(&layers, &mut index);
        }
    }
    layers
        .into_iter()
        .filter(|layer| !layer.is_empty())
        .map(|layer| layer.into_iter().map(str::to_string).collect())
        .collect()
}

pub fn next_status(current: &str) -> &'static str {
    match current {
        "NOT_STARTED" => "IN_PROGRESS",
        "IN_PROGRESS" => "COMPLETED",
        _ => "NOT_STARTED",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, status: &str) -> Node {
        Node { id: id.into(), slug: id.into(), title: id.to_uppercase(), status: status.into(), branch: None, level: "CORE".into() }
    }
    fn edge(from: &str, to: &str) -> Edge {
        Edge { from_node_id: from.into(), to_node_id: to.into(), kind: "PREREQUISITE".into() }
    }

    #[test]
    fn path_order_and_progress() {
        let nodes = vec![node("c", "NOT_STARTED"), node("a", "COMPLETED"), node("b", "COMPLETED"), node("x", "NOT_STARTED")];
        let edges = vec![edge("a", "b"), edge("b", "c"), edge("a", "c")];
        let path: Vec<&str> = path_to_target("c", &nodes, &edges).iter().map(|n| n.id.as_str()).collect();
        assert_eq!(path, vec!["a", "b", "c"]);
        assert_eq!(path_progress("c", &nodes, &edges), PathProgress { total: 3, done: 2, pct: 67 });
        let ready = ready_set(&nodes, &edges);
        assert!(ready.contains("c") && ready.contains("x"));
        assert_eq!(ancestors(&nodes, &edges)["c"], vec!["a", "b"]);
        let refs: Vec<&Node> = nodes.iter().collect();
        let l = layers(&refs, &edges);
        assert_eq!(l[0], vec!["a", "x"]);
        assert_eq!(l[1], vec!["b"]);
        assert_eq!(l[2], vec!["c"]);
    }

    #[test]
    fn bundled_math_roadmap_is_acyclic() {
        let seed = crate::seed::math_roadmap();
        let nodes: Vec<Node> = seed.nodes.iter().map(|n| node(&n.slug, "NOT_STARTED")).collect();
        let edges: Vec<Edge> = seed.edges.iter().map(|e| Edge { from_node_id: e.from.clone(), to_node_id: e.to.clone(), kind: e.kind.clone() }).collect();
        let refs: Vec<&Node> = nodes.iter().collect();
        let total: usize = layers(&refs, &edges).iter().map(Vec::len).sum();
        assert_eq!(total, nodes.len());
        let iwasawa = path_to_target("iwasawa-theory", &nodes, &edges);
        assert!(iwasawa.len() > 5);
        assert_eq!(iwasawa.last().unwrap().id, "iwasawa-theory");
    }
}
