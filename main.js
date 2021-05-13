import { mat4 } from "https://cdn.skypack.dev/gl-matrix";

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

export function getGeometryData(distanceField) {
  const positions = [];
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

    const edges = edgeBitFields[cornerMask];

    let edgeCount = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let j = 0; j < cubeEdgeCornerIndices.length; j++) {
      if (!(edges & (1 << j))) continue;
      edgeCount++;

      if (i === 9) {
        console.log(cubeEdgeCornerIndices[j]);
      }

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

    dx /= edgeCount;
    dy /= edgeCount;
    dz /= edgeCount;

    // Shift vertex to center of the grid
    const vx = x + 0.5 + dx;
    const vy = y + 0.5 + dy;
    const vz = z + 0.5 + dz;

    gridIndices[i] = positions.length / 3;
    positions.push(vx, vy, vz);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Float32Array(indices),
  };
}

const distanceField = new DistanceField(16);

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

const vertextBufferData = getGeometryData(distanceField);

const editor = document.getElementById("editor");
const canvas = editor.querySelector("canvas");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
});

gl.clearColor(0, 0, 0, 1);
gl.clearDepth(1);

const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(
  vs,
  `
uniform mat4 u_mvp;

attribute vec3 a_position;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  gl_PointSize = 2.0;
}
`
);
gl.compileShader(vs);

const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(
  fs,
  `
precision mediump float;

void main() {
  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
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

const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, vertextBufferData.positions, gl.STATIC_DRAW);
gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(a_position);

const translation = [
  distanceField.width * -0.5,
  distanceField.height * -0.5,
  distanceField.depth * -0.5,
];
const model = mat4.fromTranslation(mat4.create(), translation);

const eye = [0, 0, distanceField.depth];
const center = [0, 0, 0];
const up = [0, 1, 0];
const rotation = { x: 0, y: 0 };

const fovy = (60 / 180) * Math.PI;
const near = 0.1;
const far = 1000;

function render(timestamp) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  gl.viewport(0, 0, canvas.width, canvas.height);

  const view = mat4.lookAt(mat4.create(), eye, center, up);
  mat4.rotateX(view, view, rotation.x);
  mat4.rotateY(view, view, rotation.y);

  const aspect = canvas.width / canvas.height;
  const projection = mat4.perspective(mat4.create(), fovy, aspect, near, far);

  const mvp = mat4.create();
  mat4.multiply(mvp, view, model);
  mat4.multiply(mvp, projection, mvp);

  gl.uniformMatrix4fv(u_mvp, false, mvp);

  gl.drawArrays(gl.POINTS, 0, vertextBufferData.positions.length / 3);

  gl.flush();

  requestAnimationFrame(render);
}

let lastPointerEvent = null;
canvas.addEventListener("pointerdown", (e) => {
  lastPointerEvent = e;
});
canvas.addEventListener("pointermove", (e) => {
  if (!lastPointerEvent) return;
  if (e.buttons !== 1) return;

  const coefficient = 5;

  const movementY = e.clientY - lastPointerEvent.clientY;
  rotation.x += (movementY / e.target.clientHeight) * coefficient;
  rotation.x = Math.max(Math.PI * -0.5, rotation.x);
  rotation.x = Math.min(Math.PI * 0.5, rotation.x);

  const movementX = e.clientX - lastPointerEvent.clientX;
  rotation.y += (movementX / e.target.clientWidth) * coefficient;

  lastPointerEvent = e;
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

renderDebugPanelDistanceFieldSlice();

const debugPanelVerticesCount = debugPanel.querySelector("#vertices-count");
debugPanelVerticesCount.textContent = vertextBufferData.positions.length * 4;

const debugPanelDataCount = debugPanel.querySelector("#data-count");
debugPanelDataCount.textContent = `${distanceField.data.length * 4} bytes`;
