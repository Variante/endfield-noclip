import { type DecodedMesh, MeshTopology, VertexAttributeFormat } from '@endfield-noclip/formats/unity/mesh';
import type { Aabb } from '@endfield-noclip/formats/unity/values';

/** meshes the packer makes itself rather than reads from the install */
export type SyntheticMesh = 'cube';

/** the object key of a synthetic mesh, standing in for a mesh's `CAB-<hex>:<path id>` */
export const syntheticMeshKey = (mesh: SyntheticMesh): string => `synthetic:${mesh}`;

/**
 * @param mesh which synthetic mesh
 * @returns it decoded, as a mesh read from the install would be
 */
export const syntheticMesh = (mesh: SyntheticMesh): DecodedMesh => {
	switch (mesh) {
		case 'cube': {
			return unitCube();
		}
	}
};

/**
 * the unit cube, from −0.5 to 0.5 on each axis, with a flat normal per face. stand-ins for content the viewer
 * doesn't draw scale it to that content's bounds
 */
const unitCube = (): DecodedMesh => {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let axis = 0; axis < 3; axis++) {
		for (const sign of [-1, 1]) {
			// u and v run along the other two axes, wound so the face looks out along `sign`
			const u = (axis + (sign > 0 ? 1 : 2)) % 3;
			const v = (axis + (sign > 0 ? 2 : 1)) % 3;
			const first = positions.length / 3;
			for (const [cu, cv] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1],
			]) {
				const position = [0, 0, 0];
				position[axis] = sign * 0.5;
				position[u] = cu * 0.5;
				position[v] = cv * 0.5;
				positions.push(...position);
				const normal = [0, 0, 0];
				normal[axis] = sign;
				normals.push(...normal);
				uvs.push((cu + 1) / 2, (cv + 1) / 2);
			}
			// Unity's front faces wind clockwise
			indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
		}
	}
	const bounds: Aabb = { center: [0, 0, 0], extents: [0.5, 0.5, 0.5] };
	return {
		name: 'stand-in cube',
		vertexCount: positions.length / 3,
		channels: [],
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		packedNormals: null,
		tangents: null,
		colors: null,
		uvs: [
			{ dimension: 2, format: VertexAttributeFormat.Float32, data: new Float32Array(uvs) },
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		],
		indices: new Uint16Array(indices),
		submeshes: [
			{
				firstIndex: 0,
				indexCount: indices.length,
				topology: MeshTopology.Triangles,
				baseVertex: 0,
				firstVertex: 0,
				vertexCount: positions.length / 3,
				bounds,
			},
		],
		bounds,
		skin: null,
	};
};
