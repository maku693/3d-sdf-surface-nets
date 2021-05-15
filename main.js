import { mat4, vec3, vec2 } from "https://cdn.skypack.dev/gl-matrix";

class DistanceField {
  constructor(width, height, depth) {
    this.width = width;
    this.height = height || width;
    this.depth = depth || width;
    this.data = new Float32Array(this.width * this.height * this.depth).fill(
      Infinity
    );
  }

  drawDistanceFunction(f) {
    const { width, height, data } = this;
    for (let i = 0; i < data.length; i++) {
      const x = i % width;
      const y = Math.trunc(i / width) % height;
      const z = Math.trunc(i / width / height);
      data[i] = Math.min(
        data[i],
        // Shift the sampling point to center of the voxel
        f(x + 0.5, y + 0.5, z + 0.5)
      );
    }
  }
}

function merge(...ff) {
  return function (x, y, z) {
    return Math.min(...ff.map((f) => f(x, y, z)));
  };
}

function translate(tx, ty, tz, f) {
  return function (x, y, z) {
    return f(x - tx, y - ty, z - tz);
  };
}

function sphere(r) {
  return function (x, y, z) {
    return Math.sqrt(x * x + y * y + z * z) - r;
  };
}

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

const geometryElements = 6;
const geometryStrides = 4 * geometryElements;

export function getGeometryData(distanceField) {
  console.time("getGeometryData");
  const vertices = [];
  const gridIndices = [];
  const indices = [];

  const gridWidth = distanceField.width - 1;
  const gridHeight = distanceField.height - 1;
  const gridDepth = distanceField.depth - 1;
  const gridVolume = gridWidth * gridHeight * gridDepth;

  for (let i = 0; i < gridVolume; i++) {
    const x = i % gridWidth;
    const y = Math.trunc(i / gridWidth) % gridHeight;
    const z = Math.trunc(i / gridWidth / gridHeight);

    let cornerMask = 0;
    for (let j = 0; j < 8; j++) {
      const u = j % 2;
      const v = Math.trunc(j / 2) % 2;
      const w = Math.trunc(j / 2 / 2);

      const k =
        x +
        u +
        (y + v) * distanceField.width +
        (z + w) * distanceField.width * distanceField.height;
      if (distanceField.data[k] > 0) {
        cornerMask |= 1 << j;
      }
    }

    // skip voxel that has no positive corners
    if (cornerMask === 0b11111111) continue;

    const edges = edgeBitFields[cornerMask];

    let edgeCount = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let j = 0; j < cubeEdgeCornerIndices.length; j++) {
      if (!(edges & (1 << j))) continue;
      edgeCount++;

      const c0 = cubeEdgeCornerIndices[j][0];
      const c0x = c0 % 2;
      const c0y = Math.trunc(c0 / 2) % 2;
      const c0z = Math.trunc(c0 / 2 / 2);
      const k0 =
        x +
        c0x +
        (y + c0y) * distanceField.width +
        (z + c0z) * distanceField.width * distanceField.height;
      const d0 = distanceField.data[k0];

      const c1 = cubeEdgeCornerIndices[j][1];
      const c1x = c1 % 2;
      const c1y = Math.trunc(c1 / 2) % 2;
      const c1z = Math.trunc(c1 / 2 / 2);
      const k1 =
        x +
        c1x +
        (y + c1y) * distanceField.width +
        (z + c1z) * distanceField.width * distanceField.height;
      const d1 = distanceField.data[k1];

      dx += c0x + ((c1x - c0x) / (d1 - d0)) * (0 - d0);
      dy += c0y + ((c1y - c0y) / (d1 - d0)) * (0 - d0);
      dz += c0z + ((c1z - c0z) / (d1 - d0)) * (0 - d0);
    }

    if (edgeCount === 0) continue;

    gridIndices[i] = vertices.length / geometryElements;

    dx /= edgeCount;
    dy /= edgeCount;
    dz /= edgeCount;

    // Shift vertex to center of the grid
    const vx = x + 0.5 + dx;
    const vy = y + 0.5 + dy;
    const vz = z + 0.5 + dz;

    // position
    vertices.push(vx, vy, vz);

    // x, y, z
    const j =
      x +
      y * distanceField.width +
      z * distanceField.width * distanceField.height;
    const normal = vec3.fromValues(
      // (x + 1, y, z) - (x, y, z)
      distanceField.data[j + 1] - distanceField.data[j],
      // (x, y + 1, z) - (x, y, z)
      distanceField.data[j + distanceField.width] - distanceField.data[j],
      // (x, y, z + 1) - (x, y, z)
      distanceField.data[j + distanceField.width * distanceField.height] -
        distanceField.data[j]
    );
    vec3.normalize(normal, normal);
    // normal
    vertices.push(...normal);

    const quads = [];
    if (edges & 0b000000000001) {
      // x, y - 1, z,
      // x, y - 1, z - 1
      // x, y, z
      // x, y, z - 1
      quads.push([
        gridIndices[i - gridWidth],
        gridIndices[i - gridWidth - gridWidth * gridHeight],
        gridIndices[i],
        gridIndices[i - gridWidth * gridHeight],
      ]);
    }
    if (edges & 0b000000000010) {
      // x, y, z
      // x, y, z - 1
      // x - 1, y, z
      // x - 1, y, z - 1
      quads.push([
        gridIndices[i],
        gridIndices[i - gridWidth * gridHeight],
        gridIndices[i - 1],
        gridIndices[i - 1 - gridWidth * gridHeight],
      ]);
    }
    if (edges & 0b000000010000) {
      // x - 1, y - 1, z
      // x, y - 1, z
      // x - 1, y, z
      // x, y, z
      quads.push([
        gridIndices[i - 1 - gridWidth],
        gridIndices[i - gridWidth],
        gridIndices[i - 1],
        gridIndices[i],
      ]);
    }

    for (let j = 0; j < quads.length; j++) {
      if (cornerMask & 1) {
        indices.push(
          quads[j][0],
          quads[j][3],
          quads[j][1],
          quads[j][0],
          quads[j][2],
          quads[j][3]
        );
      } else {
        indices.push(
          quads[j][0],
          quads[j][1],
          quads[j][3],
          quads[j][0],
          quads[j][3],
          quads[j][2]
        );
      }
    }
  }

  console.timeEnd("getGeometryData");

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

const distanceField = new DistanceField(64);

distanceField.drawDistanceFunction(
  merge(
    translate(
      distanceField.width / 4,
      distanceField.height / 4,
      distanceField.depth / 2,
      sphere(distanceField.width / 6)
    ),
    translate(
      distanceField.width / 2,
      distanceField.height / 2,
      distanceField.depth / 2,
      sphere(distanceField.width / 4)
    ),
    translate(
      (distanceField.width / 4) * 3,
      (distanceField.height / 4) * 3,
      distanceField.depth / 2,
      sphere(distanceField.width / 6)
    )
  )
);

const geometryData = getGeometryData(distanceField);

const editor = document.getElementById("editor");
const canvas = editor.querySelector("canvas");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
});

gl.enable(gl.CULL_FACE);
gl.enable(gl.DEPTH_TEST);

gl.clearColor(0, 0, 0, 1);
gl.clearDepth(1);

const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(
  vs,
  `
uniform mat4 u_mvp;

attribute vec3 a_position;
attribute vec3 a_normal;

varying vec4 v_color;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_color = vec4(a_normal, 1.0);
}
`
);
gl.compileShader(vs);

const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(
  fs,
  `
precision mediump float;

varying vec4 v_color;

void main() {
  gl_FragColor = v_color;
}
`
);
gl.compileShader(fs);

const program = gl.createProgram();
gl.attachShader(program, fs);
gl.attachShader(program, vs);
gl.linkProgram(program);
gl.useProgram(program);

const u_mvp = gl.getUniformLocation(program, "u_mvp");
const a_position = gl.getAttribLocation(program, "a_position");
const a_normal = gl.getAttribLocation(program, "a_normal");

const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, geometryData.vertices, gl.DYNAMIC_DRAW);
gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, geometryStrides, 0);
gl.enableVertexAttribArray(a_position);
gl.vertexAttribPointer(a_normal, 3, gl.FLOAT, true, geometryStrides, 12);
gl.enableVertexAttribArray(a_normal);

const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometryData.indices, gl.DYNAMIC_DRAW);

const translation = [
  distanceField.width * -0.5,
  distanceField.height * -0.5,
  distanceField.depth * -0.5,
];
const model = mat4.fromTranslation(mat4.create(), translation);

const eye = [0, 0, distanceField.depth];
const center = [0, 0, 0];
const up = [0, 1, 0];
const eyeRotation = [0, 0];
let eyeDistance = 0;

const fovy = (60 / 180) * Math.PI;
const near = 0.001;
const far = 1000;

function render(timestamp) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  gl.viewport(0, 0, canvas.width, canvas.height);

  const view = mat4.lookAt(mat4.create(), eye, center, up);
  mat4.translate(view, view, [0, 0, eyeDistance]);
  mat4.rotateX(view, view, eyeRotation[0]);
  mat4.rotateY(view, view, eyeRotation[1]);

  const aspect = canvas.width / canvas.height;
  const projection = mat4.perspective(mat4.create(), fovy, aspect, near, far);

  const mvp = mat4.create();
  mat4.multiply(mvp, view, model);
  mat4.multiply(mvp, projection, mvp);

  gl.uniformMatrix4fv(u_mvp, false, mvp);

  gl.drawElements(
    gl.TRIANGLES,
    geometryData.indices.length,
    gl.UNSIGNED_SHORT,
    0
  );

  gl.flush();

  requestAnimationFrame(render);
}

let lastPointerPosition = null;

function getMousePointerPosition(e) {
  return vec2.fromValues(e.clientX, e.clientY);
}

function getTouchPointerPosition(e) {
  return vec2.fromValues(e.touches[0].clientX, e.touches[0].clientY);
}

function updateEyeRotation(pointerPosition) {
  if (!lastPointerPosition) return;

  const coefficient = 5;

  const my = pointerPosition[1] - lastPointerPosition[1]; // lastPointerEvent.clientY;
  eyeRotation[0] += (my / canvas.clientHeight) * coefficient;
  // Limit rotation
  eyeRotation[0] = Math.max(Math.PI * -0.5, eyeRotation[0]);
  eyeRotation[0] = Math.min(Math.PI * 0.5, eyeRotation[0]);

  const mx = pointerPosition[0] - lastPointerPosition[0]; // lastPointerEvent.clientX;
  eyeRotation[1] += (mx / canvas.clientWidth) * coefficient;

  lastPointerPosition = pointerPosition;
}

function updateEyeDistance(movement) {
  eyeDistance += movement;
}

canvas.addEventListener("mousedown", (e) => {
  e.preventDefault();

  lastPointerPosition = getMousePointerPosition(e);
});
canvas.addEventListener("mousemove", (e) => {
  e.preventDefault();

  if (e.buttons !== 1) return;

  updateEyeRotation(getMousePointerPosition(e));
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const coefficient = 0.1;

  updateEyeDistance(e.deltaY * coefficient * -1);
});

let lastTouchDistance = 0;

function getTouchDistance(e) {
  const t0 = vec2.fromValues(e.touches[0].clientX, e.touches[0].clientY);
  const t1 = vec2.fromValues(e.touches[1].clientX, e.touches[1].clientY);
  return vec2.distance(t0, t1);
}

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();

  if (e.touches.length === 1) {
    lastPointerPosition = getTouchPointerPosition(e);
  }
  if (e.touches.length === 2) {
    lastTouchDistance = getTouchDistance(e);
  }
});

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();

  if (e.touches.length === 1) {
    updateEyeRotation(getTouchPointerPosition(e));
  }
  if (e.touches.length === 2) {
    const touchDistance = getTouchDistance(e);
    const coefficient = 0.1;

    updateEyeDistance((touchDistance - lastTouchDistance) * coefficient);

    lastTouchDistance = touchDistance;
  }
});

requestAnimationFrame(render);

const debugPanel = document.getElementById("debug-panel");
const debugPanelCanvas = debugPanel.querySelector("canvas");
debugPanelCanvas.width = distanceField.width;
debugPanelCanvas.height = distanceField.height;
const debugPanelInput = debugPanel.querySelector("input");
debugPanelInput.min = 0;
debugPanelInput.value = 0;
debugPanelInput.max = distanceField.depth - 1;
const debugPanelSDFSliceZ = debugPanel.querySelector("#sdf-slice-z");

function renderDebugPanelDistanceFieldSlice() {
  const ctx = debugPanelCanvas.getContext("2d");
  const distanceFieldSliceArea = distanceField.width * distanceField.height;
  const z = debugPanelInput.valueAsNumber;
  debugPanelSDFSliceZ.textContent = z;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 0; i < distanceFieldSliceArea; i++) {
    const x = i % distanceField.width;
    const y = Math.trunc(i / distanceField.width);

    const j =
      x +
      y * distanceField.width +
      z * distanceField.width * distanceField.height;
    const value = distanceField.data[j];

    const r = value > 0 ? Math.min(255, 255 * value) : 0;
    const g = value < 0 ? Math.min(255, 255 * value * -1) : 0;
    ctx.fillStyle = `rgba(${r}, ${g}, 0, 1)`;
    // inverse y axis because data has right-handed coordinate system
    ctx.fillRect(x, distanceField.height - 1 - y, 1, 1);
  }
}

debugPanelInput.addEventListener("input", () => {
  renderDebugPanelDistanceFieldSlice();
});

const decimalFormat = new Intl.NumberFormat("en", {
  style: "decimal",
});
const byteStandardFormat = new Intl.NumberFormat("en", {
  notation: "standard",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});
const byteCompactFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

debugPanel.querySelector("#field-width").textContent = distanceField.width;
debugPanel.querySelector("#field-height").textContent = distanceField.height;
debugPanel.querySelector("#field-depth").textContent = distanceField.depth;

debugPanel.querySelector("#data-count").textContent =
  byteStandardFormat.format(distanceField.data.length * 4) +
  ` (${byteCompactFormat.format(distanceField.data.length * 4)})`;

debugPanel.querySelector("#vertices-count").textContent = decimalFormat.format(
  geometryData.vertices.length / 6
);

renderDebugPanelDistanceFieldSlice();
