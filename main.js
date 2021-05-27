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
      const y = ((i / width) | 0) % height;
      const z = (i / width / height) | 0;
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
    return vec3.length([x, y, z]) - r;
  };
}

function torus(rr, r) {
  return function (x, y, z) {
    const q = [vec2.length([x, z]) - rr, y];
    return vec2.length(q) - r;
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
  const vertices = [];
  const gridIndices = [];
  const indices = [];

  const gridWidth = distanceField.width - 1;
  const gridHeight = distanceField.height - 1;
  const gridDepth = distanceField.depth - 1;
  const gridVolume = gridWidth * gridHeight * gridDepth;

  for (let i = 0; i < gridVolume; i++) {
    const x = i % gridWidth;
    const y = ((i / gridWidth) | 0) % gridHeight;
    const z = (i / gridWidth / gridHeight) | 0;

    let cornerMask = 0;
    for (let j = 0; j < 8; j++) {
      const u = j % 2;
      const v = ((j / 2) | 0) % 2;
      const w = (j / 2 / 2) | 0;

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
      const c0y = ((c0 / 2) | 0) % 2;
      const c0z = (c0 / 2 / 2) | 0;
      const k0 =
        x +
        c0x +
        (y + c0y) * distanceField.width +
        (z + c0z) * distanceField.width * distanceField.height;
      const d0 = distanceField.data[k0];

      const c1 = cubeEdgeCornerIndices[j][1];
      const c1x = c1 % 2;
      const c1y = ((c1 / 2) | 0) % 2;
      const c1z = (c1 / 2 / 2) | 0;
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

    // build vertex buffer

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
    const d0 = distanceField.data[j];
    const d1 = distanceField.data[j + 1];
    const d2 = distanceField.data[j + distanceField.width];
    const d3 = distanceField.data[j + 1 + distanceField.width];
    const d4 =
      distanceField.data[j + distanceField.width * distanceField.height];
    const d5 =
      distanceField.data[j + 1 + distanceField.width * distanceField.height];
    const d6 =
      distanceField.data[
        j + distanceField.width + distanceField.width * distanceField.height
      ];
    const d7 =
      distanceField.data[
        j + 1 + distanceField.width + distanceField.width * distanceField.height
      ];
    const normal = [
      (d1 - d0 + d3 - d2 + d5 - d4 + d7 - d6) / 4,
      (d2 - d0 + d3 - d1 + d6 - d4 + d7 - d5) / 4,
      (d4 - d0 + d5 - d1 + d6 - d2 + d7 - d3) / 4,
    ];
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

    // build index buffer
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

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

const distanceField = new DistanceField(64);

distanceField.drawDistanceFunction(
  translate(
    distanceField.width / 2,
    distanceField.height / 2,
    distanceField.depth / 2,
    merge(
      sphere(distanceField.width / 4),
      torus(distanceField.width / 4, distanceField.width / 16)
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

gl.clearColor(0, 0, 0, 1);
gl.clearDepth(1);

gl.enable(gl.CULL_FACE);
gl.enable(gl.DEPTH_TEST);

const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(
  vs,
  `
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;

attribute vec3 a_position;
attribute vec3 a_normal;

varying vec3 v_position;
varying vec3 v_normal;
varying vec3 v_diffuse;
varying vec3 v_specular;

void main() {
  vec4 position = u_model * vec4(a_position, 1.0);
  gl_Position = u_projection * u_view * position;
  v_position = position.xyz / position.w;
  v_normal = a_normal;
  v_diffuse = vec3(normalize(a_position));
  v_specular = vec3(1.0);
}
`
);
gl.compileShader(vs);

const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(
  fs,
  `
precision mediump float;

struct Light {
  vec3 color;
  float power;
  vec3 position;
};

uniform vec3 u_eye;

const vec3 environment = vec3(0.1);

varying vec3 v_position;
varying vec3 v_normal;
varying vec3 v_diffuse;
varying vec3 v_specular;

const float shininess = 60.0;

const int lightCount = 2;
Light lights[lightCount];

vec3 lambert(Light light) {
  vec3 denormalizedL = light.position - v_position;
  vec3 l = normalize(denormalizedL);
  float d = max(0.0, dot(v_normal, l));
  return v_diffuse * d * light.color * light.power /
    dot(denormalizedL, denormalizedL);
}

vec3 blinnPhong(Light light) {
  vec3 denormalizedL = light.position - v_position;
  float squaredLengthL = dot(denormalizedL, denormalizedL);
  float lightIlluminance = light.power / squaredLengthL;
  vec3 l = normalize(denormalizedL);
  vec3 e = normalize(u_eye - v_position);
  vec3 h = normalize(l + e);
  float d = max(0.0, dot(v_normal, l));
  float s = pow(max(0.0, dot(v_normal, h)), shininess);
  return (v_specular * s + v_diffuse * d) * light.color * lightIlluminance;
}

void main() {
  lights[0] = Light(vec3(1.0), 10000.0, vec3(64.0, 64.0, 64.0));
  lights[1] = Light(vec3(1.0), 1000.0, vec3(-64.0, -64.0, -64.0));

  vec3 color;
  for (int i = 0; i < lightCount; i++) {
    if (i == 0) {
      color += blinnPhong(lights[0]);
    }
    if (i == 1) {
      color += blinnPhong(lights[1]);
    }
  }
  color += v_diffuse * environment;
  color = pow(color, vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}
`
);
gl.compileShader(fs);

const program = gl.createProgram();
gl.attachShader(program, fs);
gl.attachShader(program, vs);
gl.linkProgram(program);
gl.useProgram(program);

const u_model = gl.getUniformLocation(program, "u_model");
const u_view = gl.getUniformLocation(program, "u_view");
const u_projection = gl.getUniformLocation(program, "u_projection");
const u_eye = gl.getUniformLocation(program, "u_eye");
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

const eyeRotation = [0, 0];
let eyeDistance = distanceField.depth;
const center = [0, 0, 0];
const up = [0, 1, 0];

const fovy = (60 / 180) * Math.PI;
const near = 0.001;
const far = 1000;

function render(timestamp) {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye = [0, 0, eyeDistance];
  vec3.rotateX(eye, eye, center, eyeRotation[0]);
  vec3.rotateY(eye, eye, center, eyeRotation[1]);
  const view = mat4.lookAt(mat4.create(), eye, center, up);

  const aspect = canvas.width / canvas.height;
  const projection = mat4.perspective(mat4.create(), fovy, aspect, near, far);

  const mvp = mat4.create();
  mat4.multiply(mvp, view, model);
  mat4.multiply(mvp, projection, mvp);

  gl.uniformMatrix4fv(u_model, false, model);
  gl.uniformMatrix4fv(u_view, false, view);
  gl.uniformMatrix4fv(u_projection, false, projection);
  gl.uniform3fv(u_eye, eye);

  gl.drawElements(
    gl.TRIANGLES,
    geometryData.indices.length,
    gl.UNSIGNED_SHORT,
    0
  );

  gl.flush();

  requestAnimationFrame(render);
}

let pointerEvents = [];
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  pointerEvents.push(e);
});
let lastTouchDistance = 0;
canvas.addEventListener("pointermove", (e) => {
  e.preventDefault();

  if (pointerEvents.length === 1) {
    const coefficient = 5;

    const my = e.clientY - pointerEvents[0].clientY;
    eyeRotation[0] += (my / canvas.clientHeight) * coefficient * -1;
    // Limit rotation
    eyeRotation[0] = Math.max(Math.PI * -0.5, eyeRotation[0]);
    eyeRotation[0] = Math.min(Math.PI * 0.5, eyeRotation[0]);

    const mx = e.clientX - pointerEvents[0].clientX;
    eyeRotation[1] += (mx / canvas.clientWidth) * coefficient * -1;
    eyeRotation[1] %= Math.PI * 2;

    pointerEvents[0] = e;

    return;
  }

  if (pointerEvents.length === 2) {
    for (let i = 0; i < pointerEvents.length; i++) {
      if (pointerEvents[i].pointerId === e.pointerId) {
        pointerEvents[i] = e;
        break;
      }
    }

    const t0 = [pointerEvents[0].clientX, pointerEvents[0].clientY];
    const t1 = [pointerEvents[1].clientX, pointerEvents[1].clientY];
    const touchDistance = vec2.distance(t0, t1);

    if (lastTouchDistance > 0) {
      const coefficient = 0.5;
      eyeDistance -= (touchDistance - lastTouchDistance) * coefficient;
    }

    lastTouchDistance = touchDistance;
  }
});
canvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  lastTouchDistance = 0;
  pointerEvents = [];
});
canvas.addEventListener("pointercancel", (e) => {
  e.preventDefault();
  lastTouchDistance = 0;
  pointerEvents = [];
});
canvas.addEventListener("pointerleave", (e) => {
  e.preventDefault();
  lastTouchDistance = 0;
  pointerEvents = [];
});
canvas.addEventListener("pointerout", (e) => {
  e.preventDefault();
  lastTouchDistance = 0;
  pointerEvents = [];
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const coefficient = 0.1;

  eyeDistance += e.deltaY * coefficient;
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
    const y = (i / distanceField.width) | 0;

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
