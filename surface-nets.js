const cubeEdgeCornerIndices = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

const edgeBitFields = new Array(256);
{
  for (let cornerBits = 0; cornerBits < edgeBitFields.length; cornerBits++) {
    let field = 0;
    for (let j = 0; j < cubeEdgeCornerIndices.length; j++) {
      const cornerBitsA = 1 << cubeEdgeCornerIndices[j][0];
      const cornerBitsB = 1 << cubeEdgeCornerIndices[j][1];
      const isCornerInVolumeA = (cornerBits & cornerBitsA) !== 0;
      const isCornerInVolumeB = (cornerBits & cornerBitsB) !== 0;
      const isOnlyOneOfCornerInVolume = isCornerInVolumeA !== isCornerInVolumeB;
      field |= isOnlyOneOfCornerInVolume << j;
    }
    edgeBitFields[cornerBits] = field;
  }
}

const quadCornerIndices = [
  [0, 1, 3, 0, 3, 2],
  [0, 3, 1, 0, 2, 3],
  [0, 1, 2, 1, 3, 2],
  [0, 2, 1, 1, 2, 3],
];

const positions = new Float32Array(16384);
const normals = new Float32Array(16384);
const indices = new Uint32Array(32568);
const gridIndices = {};
const quads = new Array(3);

export function getGeometryData(width, height, depth, data) {
  let verticesCount = 0;
  let indicesCount = 0;

  const fieldWidth = width;
  const fieldHeight = height;
  const fieldDepth = depth;

  const gridWidth = fieldWidth - 1;
  const gridHeight = fieldHeight - 1;
  const gridDepth = fieldDepth - 1;

  let i = -1;
  for (let z = 0; z < gridDepth; z++) {
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        i++;
        let cornerMask = 0;
        let quadCount = 0;

        for (let j = 0; j < 8; j++) {
          const u = j & 1;
          const v = (j >> 1) & 1;
          const w = (j >> 2) & 1;
          const k =
            x + u + (y + v) * fieldWidth + (z + w) * fieldWidth * fieldHeight;
          if (data[k] > 0) {
            cornerMask |= 1 << j;
          }
        }

        // skip voxel that has no positive or negative corners
        if (cornerMask === 0 || cornerMask === 0b11111111) continue;

        const edges = edgeBitFields[cornerMask];

        let edgeCount = 0;
        let dx = 0;
        let dy = 0;
        let dz = 0;
        for (let j = 0; j < 12; j++) {
          if (!(edges & (1 << j))) continue;
          edgeCount++;

          const c0 = cubeEdgeCornerIndices[j][0];
          const c0x = c0 & 1;
          const c0y = (c0 >> 1) & 1;
          const c0z = (c0 >> 2) & 1;
          const k0 =
            x +
            c0x +
            (y + c0y) * fieldWidth +
            (z + c0z) * fieldWidth * fieldHeight;
          const d0 = data[k0];

          const c1 = cubeEdgeCornerIndices[j][1];
          const c1x = c1 & 1;
          const c1y = (c1 >> 1) & 1;
          const c1z = (c1 >> 2) & 1;
          const k1 =
            x +
            c1x +
            (y + c1y) * fieldWidth +
            (z + c1z) * fieldWidth * fieldHeight;
          const d1 = data[k1];

          dx += c0x + ((c1x - c0x) / (d1 - d0)) * (0 - d0);
          dy += c0y + ((c1y - c0y) / (d1 - d0)) * (0 - d0);
          dz += c0z + ((c1z - c0z) / (d1 - d0)) * (0 - d0);
        }

        if (edgeCount === 0) continue;

        gridIndices[i] = verticesCount / 3;

        dx /= edgeCount;
        dy /= edgeCount;
        dz /= edgeCount;

        // Shift vertex to center of the grid
        const vx = x + 0.5 + dx;
        const vy = y + 0.5 + dy;
        const vz = z + 0.5 + dz;
        positions[verticesCount] = vx;
        positions[verticesCount + 1] = vy;
        positions[verticesCount + 2] = vz;

        // x, y, z
        const j = x + y * fieldWidth + z * fieldWidth * fieldHeight;
        const d0 = data[j];
        const d1 = data[j + 1];
        const d2 = data[j + fieldWidth];
        const d3 = data[j + 1 + fieldWidth];
        const d4 = data[j + fieldWidth * fieldHeight];
        const d5 = data[j + 1 + fieldWidth * fieldHeight];
        const d6 = data[j + fieldWidth + fieldWidth * fieldHeight];
        const d7 = data[j + 1 + fieldWidth + fieldWidth * fieldHeight];
        normals[verticesCount] = d1 - d0 + d3 - d2 + d5 - d4 + d7 - d6;
        normals[verticesCount + 1] = d2 - d0 + d3 - d1 + d6 - d4 + d7 - d5;
        normals[verticesCount + 2] = d4 - d0 + d5 - d1 + d6 - d2 + d7 - d3;

        // normalize
        let normalLength = 0;
        for (let j = 0; j < 3; j++) {
          const p = normals[verticesCount + j];
          normalLength += p * p;
        }
        normalLength = Math.sqrt(normalLength);

        for (let j = 0; j < 3; j++) {
          normals[verticesCount + j] =
            normals[verticesCount + j] / normalLength;
        }

        verticesCount += 3;

        if (edges & 0b000000000001) {
          // x, y - 1, z,
          // x, y - 1, z - 1
          // x, y, z
          // x, y, z - 1
          quads[quadCount] = [
            gridIndices[i - gridWidth],
            gridIndices[i - gridWidth - gridWidth * gridHeight],
            gridIndices[i],
            gridIndices[i - gridWidth * gridHeight],
          ];
          quadCount++;
        }
        if (edges & 0b000000000010) {
          // x, y, z
          // x, y, z - 1
          // x - 1, y, z
          // x - 1, y, z - 1
          quads[quadCount] = [
            gridIndices[i],
            gridIndices[i - gridWidth * gridHeight],
            gridIndices[i - 1],
            gridIndices[i - 1 - gridWidth * gridHeight],
          ];
          quadCount++;
        }
        if (edges & 0b000000010000) {
          // x - 1, y - 1, z
          // x, y - 1, z
          // x - 1, y, z
          // x, y, z
          quads[quadCount] = [
            gridIndices[i - 1 - gridWidth],
            gridIndices[i - gridWidth],
            gridIndices[i - 1],
            gridIndices[i],
          ];
          quadCount++;
        }

        if (quadCount === 0) continue;

        // build index buffer
        for (let j = 0; j < quadCount; j++) {
          const quad = quads[j];
          const a = quad[0] * 3;
          const b = quad[1] * 3;
          const c = quad[2] * 3;
          const d = quad[3] * 3;
          // squared lengthes
          let l = 0;
          let m = 0;
          for (let k = 0; k < 3; k++) {
            const p = positions[a + k] - positions[d + k];
            const q = positions[b + k] - positions[c + k];
            l += p * p;
            m += q * q;
          }
          // connect shorter diagonal
          const quadIndex =
            quadCornerIndices[(cornerMask & 1) + ((l > m) << 1)];
          for (let k = 0; k < 6; k++) {
            indices[indicesCount + k] = quad[quadIndex[k]];
          }
          indicesCount += 6;
        }
      }
    }
  }

  return {
    positions: positions.subarray(0, verticesCount),
    normals: normals.subarray(0, verticesCount),
    indices: indices.subarray(0, indicesCount),
  };
}
