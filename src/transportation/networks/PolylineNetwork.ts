/** Connected, reusable polyline graph for road, rail, and modeled water routes. */
export interface NetworkEdge {
  id: string;
  points: [number, number][];
  kind: string;
  oneWay?: boolean;
  speedLimitKph?: number;
}
export interface NetworkNode { id: string; x: number; z: number; edgeIds: string[]; }
export interface PolylineNetwork { nodes: Map<string, NetworkNode>; edges: Map<string, NetworkEdge>; }

const nodeId = (x: number, z: number) => `${Math.round(x / 2) * 2}:${Math.round(z / 2) * 2}`;

export function buildPolylineNetwork(edges: NetworkEdge[]): PolylineNetwork {
  const nodes = new Map<string, NetworkNode>();
  const valid = new Map<string, NetworkEdge>();
  for (const edge of edges) {
    if (edge.points.length < 2) continue;
    valid.set(edge.id, edge);
    for (const [x, z] of [edge.points[0], edge.points.at(-1)!]) {
      const id = nodeId(x, z);
      const node = nodes.get(id) ?? { id, x, z, edgeIds: [] };
      node.edgeIds.push(edge.id);
      nodes.set(id, node);
    }
  }
  return { nodes, edges: valid };
}

/** Excludes paths that cannot legally support ordinary motor traffic. */
export function motorVehicleEdges<T extends NetworkEdge>(edges: T[]): T[] {
  const excluded = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps']);
  return edges.filter((edge) => !excluded.has(edge.kind));
}
