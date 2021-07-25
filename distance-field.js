export function merge(...ff) {
  return function (x, y, z) {
    let res = Infinity;
    for (const f of ff) {
      const tmp = f(x, y, z);
      if (tmp < res) {
        res = tmp;
      }
    }
    return res;
  };
}

export function sphere(cx, cy, cz, r) {
  return function (x, y, z) {
    return (
      Math.sqrt(
        Math.pow(x - cx, 2) + Math.pow(y - cy, 2) + Math.pow(z - cz, 2)
      ) - r
    );
  };
}

export function draw(width, height, depth, data, scene) {
  let i = 0;
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data[i] = Math.min(
          data[i],
          // Shift the sampling point to center of the voxel
          scene(x + 0.5, y + 0.5, z + 0.5)
        );
        i++;
      }
    }
  }
}
