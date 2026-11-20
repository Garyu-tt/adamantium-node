/**
 * Adamantium-node R06 — narrow stdin adapter to canonical CPU-first G0.
 *
 * Compile this file AGAINST the pinned Garyu-tt/AdamantiumToolBox
 * native/universal-graph C++17 library (PR #143, commit da55544...).
 * We intentionally do not vendor the native compiler into the editor.
 *
 * This executable only parses a bounded, source-free typed wire format and
 * calls mas::graph::compile(). It never loads plugins or executes graph code.
 * SPDX-License-Identifier: Apache-2.0
 */
#include "mas/universal_graph.hpp"
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace {
using namespace mas::graph;
constexpr std::size_t kMaxInput = 2'000'000;

std::string read_token(std::istream& in) {
  std::string token;
  if (!(in >> token) || token.size() > 300) throw std::runtime_error("missing/long token");
  return token;
}
void expect(std::istream& in, const std::string& wanted) {
  if (read_token(in) != wanted) throw std::runtime_error("unexpected wire token");
}
std::size_t count(std::istream& in, std::size_t limit) {
  const auto raw = read_token(in);
  if (raw.empty() || raw.size() > 10 || raw[0] == '-' ||
      raw.find_first_not_of("0123456789") != std::string::npos)
    throw std::runtime_error("invalid count");
  const auto parsed = std::stoull(raw);
  if (parsed > limit) throw std::runtime_error("count exceeds limit");
  return static_cast<std::size_t>(parsed);
}
std::uint64_t revision(std::istream& in) {
  const auto raw = read_token(in);
  if (raw.empty() || raw.size() > 20 || raw[0] == '-' ||
      raw.find_first_not_of("0123456789") != std::string::npos)
    throw std::runtime_error("invalid revision");
  return std::stoull(raw);
}
std::string empty_ref(std::string token) { return token == "-" ? "" : token; }
Domain domain(const std::string& x) {
  if (x == "general") return Domain::General;
  if (x == "program") return Domain::Program;
  if (x == "genesis") return Domain::Genesis;
  if (x == "neural") return Domain::Neural;
  if (x == "infrastructure") return Domain::Infrastructure;
  if (x == "interface") return Domain::Interface;
  throw std::runtime_error("invalid domain");
}
NodeKind kind(const std::string& x) {
  if (x == "service") return NodeKind::Service;
  if (x == "composite") return NodeKind::Composite;
  throw std::runtime_error("unsupported node kind");
}
Direction direction(const std::string& x) {
  if (x == "input") return Direction::Input;
  if (x == "output") return Direction::Output;
  throw std::runtime_error("invalid direction");
}
Semantics semantics(const std::string& x) {
  if (x == "data") return Semantics::Data;
  if (x == "control") return Semantics::Control;
  if (x == "event") return Semantics::Event;
  if (x == "signal") return Semantics::Signal;
  throw std::runtime_error("unsupported semantic-only wire");
}
Port port(std::istream& in) {
  expect(in, "PORT");
  Port p;
  p.id = read_token(in);
  p.data_type = read_token(in);
  p.direction = direction(read_token(in));
  p.semantics = semantics(read_token(in));
  return p;
}
Edge edge(std::istream& in) {
  expect(in, "EDGE");
  Edge e;
  e.id = read_token(in);
  e.from_node = read_token(in);
  e.from_port = read_token(in);
  e.to_node = read_token(in);
  e.to_port = read_token(in);
  e.semantics = semantics(read_token(in));
  const auto delay = revision(in);
  if (delay > std::numeric_limits<std::uint32_t>::max())
    throw std::runtime_error("delay out of range");
  e.delay_ticks = static_cast<std::uint32_t>(delay);
  return e;
}
} // namespace

int main() {
  try {
    // Bound the entire input before parsing into native graph objects.
    std::string payload;
    payload.reserve(8192);
    char chunk[4096];
    while (std::cin.good()) {
      std::cin.read(chunk, sizeof(chunk));
      const auto size = std::cin.gcount();
      if (size > 0) {
        if (payload.size() + static_cast<std::size_t>(size) > kMaxInput)
          throw std::runtime_error("input budget exceeded");
        payload.append(chunk, static_cast<std::size_t>(size));
      }
    }
    std::istringstream in(payload);
    expect(in, "UGIR1");
    expect(in, "ROOT");
    const std::string root = read_token(in);
    const auto graph_count = count(in, 2048);
    if (!graph_count) throw std::runtime_error("empty catalog");
    Catalog catalog;
    std::size_t total_nodes = 0, total_edges = 0;
    for (std::size_t i = 0; i < graph_count; ++i) {
      expect(in, "GRAPH");
      Graph graph;
      graph.id = read_token(in);
      graph.revision = revision(in);
      graph.domain = domain(read_token(in));
      graph.schema_version = static_cast<std::uint32_t>(revision(in));
      const auto port_count = count(in, 4096);
      const auto node_count = count(in, 100000);
      const auto edge_count = count(in, 200000);
      if (node_count > 100000 - total_nodes || edge_count > 200000 - total_edges)
        throw std::runtime_error("total graph budget exceeded");
      total_nodes += node_count;
      total_edges += edge_count;
      graph.interface_ports.reserve(port_count);
      for (std::size_t p = 0; p < port_count; ++p) graph.interface_ports.push_back(port(in));
      graph.nodes.reserve(node_count);
      for (std::size_t n = 0; n < node_count; ++n) {
        expect(in, "NODE");
        Node node;
        node.id = read_token(in);
        node.kind = kind(read_token(in));
        node.type_ref = empty_ref(read_token(in));
        node.graph_ref = empty_ref(read_token(in));
        node.graph_ref_revision = revision(in);
        const auto local_ports = count(in, 4096);
        node.ports.reserve(local_ports);
        for (std::size_t p = 0; p < local_ports; ++p) node.ports.push_back(port(in));
        graph.nodes.push_back(std::move(node));
      }
      graph.edges.reserve(edge_count);
      for (std::size_t e = 0; e < edge_count; ++e) graph.edges.push_back(edge(in));
      expect(in, "ENDGRAPH");
      const auto name = graph.id;
      if (!catalog.emplace(name, std::move(graph)).second)
        throw std::runtime_error("duplicate catalog graph");
    }
    expect(in, "END");
    std::string extra;
    if (in >> extra) throw std::runtime_error("trailing input");
    const auto result = compile(catalog, root);
    if (!result.ok) {
      const auto& d = result.diagnostics.at(0);
      std::cout << "REJECT " << static_cast<int>(d.code) << " " << d.graph
                << " " << d.subject << "\n";
      return 2;
    }
    if (result.reachable_graphs != catalog.size())
      throw std::runtime_error("unreachable graph in native catalog");
    std::cout << "OK " << result.reachable_graphs << " " << result.nodes
              << " " << result.edges << "\n";
    return 0;
  } catch (const std::exception&) {
    // Deliberately do not leak source fragments or secrets in error messages.
    std::cout << "INVALID_INPUT\n";
    return 3;
  }
}
