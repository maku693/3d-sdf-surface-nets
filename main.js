import { mat4, vec3, vec2 } from "https://cdn.skypack.dev/gl-matrix";
import { sphere, draw } from "./distance-field.js";
import { getGeometryData } from "./surface-nets.js";

const width = 32;
const height = width;
const depth = width;
const data = new Float32Array(width * height * depth).fill(Infinity);

draw(
  width,
  height,
  depth,
  data,
  sphere(width / 2, height / 2, depth / 2, width / 4)
);

const geometryData = getGeometryData(width, height, depth, data);

const editor = document.getElementById("editor");
const canvas = editor.querySelector("canvas");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
});

gl.getExtension("OES_element_index_uint");

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
varying float v_roughness;

void main() {
  vec4 position = u_model * vec4(a_position, 1.0);
  gl_Position = u_projection * u_view * position;
  v_position = position.xyz / position.w;
  v_normal = a_normal;
  v_diffuse = vec3(0.5);
  v_roughness = 0.5;
}
`
);
gl.compileShader(vs);

const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(
  fs,
  `
precision mediump float;

const float M_PI = acos(-1.0);
const float M_1_PI = 1.0 / M_PI;

struct Light {
  vec3 color;
  float power;
  vec3 position;
};

uniform vec3 u_eye;
const int lightCount = 2;
Light lights[2];

varying highp vec3 v_position;
varying vec3 v_normal;
varying vec3 v_diffuse;
varying float v_roughness;

const float ior = 1.5;

float pow2(float f) {
  return f * f;
}

float pow5(float f) {
  return f * f * f * f * f;
}

vec3 pbs(Light light) {
  vec3 denormalizedL = light.position - v_position;
  float squaredLengthL = dot(denormalizedL, denormalizedL);
  float lightIlluminance = light.power / squaredLengthL;
  vec3 l = normalize(denormalizedL);
  vec3 v = normalize(u_eye - v_position);
  vec3 h = normalize(l + v);
  float nDotL = dot(v_normal, l);
  float nDotV = dot(v_normal, v);
  float nDotH = dot(v_normal, h);
  float hDotL = dot(h, l);
  float hDotV = dot(h, v);
  float alpha = pow2(v_roughness);
  float alphaPow2 = pow2(alpha);

  vec3 diffuse = v_diffuse * max(0.0, nDotL) * M_1_PI;

  float V =
    max(0.0, hDotL) /
    (abs(nDotL) + sqrt(alphaPow2 + (1.0 - alphaPow2) * pow2(nDotL))) *
    max(0.0, hDotV) /
    (abs(nDotV) + sqrt(alphaPow2 + (1.0 - alphaPow2) * pow2(nDotV)));
  float D =
    alphaPow2 * max(0.0, nDotH) /
    (M_PI * pow2(pow2(nDotH) * (alphaPow2 - 1.0) + 1.0));
  vec3 specular = vec3(D * V);

  float f0 = pow2((1.0 - ior) / (1.0 + ior));
  float fresnel = f0 + (1.0 - f0) * pow5(1.0 - abs(hDotV));

  return mix(diffuse, specular, fresnel) * light.color * lightIlluminance;
}

void main() {
  lights[0] = Light(vec3(1.0), 10000.0, vec3(64.0, 64.0, 64.0));
  lights[1] = Light(vec3(1.0), 10000.0, vec3(-64.0, -64.0, -64.0));

  vec3 color;
  for (int i = 0; i < lightCount; i++) {
    if (i == 0) {
      color += pbs(lights[0]);
    }
    if (i == 1) {
      color += pbs(lights[1]);
    }
  }
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
gl.bufferData(gl.ARRAY_BUFFER, geometryData.positions, gl.STATIC_DRAW);
gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(a_position);

const normalBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
gl.bufferData(gl.ARRAY_BUFFER, geometryData.normals, gl.STATIC_DRAW);
gl.vertexAttribPointer(a_normal, 3, gl.FLOAT, true, 0, 0);
gl.enableVertexAttribArray(a_normal);

const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometryData.indices, gl.STATIC_DRAW);

const translation = [width * -0.5, height * -0.5, depth * -0.5];
const model = mat4.fromTranslation(mat4.create(), translation);

const eyeRotation = [0, 0];
let eyeDistance = depth;
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
    gl.UNSIGNED_INT,
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
debugPanelCanvas.width = width;
debugPanelCanvas.height = height;
const debugPanelInput = debugPanel.querySelector("input");
debugPanelInput.min = 0;
debugPanelInput.value = 0;
debugPanelInput.max = depth - 1;
const debugPanelSDFSliceZ = debugPanel.querySelector("#sdf-slice-z");

function renderDebugPanelDistanceFieldSlice() {
  const ctx = debugPanelCanvas.getContext("2d");
  const distanceFieldSliceArea = width * height;
  const z = debugPanelInput.valueAsNumber;
  debugPanelSDFSliceZ.textContent = z;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 0; i < distanceFieldSliceArea; i++) {
    const x = i % width;
    const y = (i / width) | 0;

    const j = x + y * width + z * width * height;
    const value = data[j];

    const r = value > 0 ? Math.min(255, 255 * value) : 0;
    const g = value < 0 ? Math.min(255, 255 * value * -1) : 0;
    ctx.fillStyle = `rgba(${r}, ${g}, 0, 1)`;
    // inverse y axis because data has right-handed coordinate system
    ctx.fillRect(x, height - 1 - y, 1, 1);
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

debugPanel.querySelector("#field-width").textContent = width;
debugPanel.querySelector("#field-height").textContent = height;
debugPanel.querySelector("#field-depth").textContent = depth;

debugPanel.querySelector("#data-count").textContent =
  byteStandardFormat.format(data.length * 4) +
  ` (${byteCompactFormat.format(data.length * 4)})`;

debugPanel.querySelector("#vertices-count").textContent = decimalFormat.format(
  geometryData.positions.length / 6
);

renderDebugPanelDistanceFieldSlice();
