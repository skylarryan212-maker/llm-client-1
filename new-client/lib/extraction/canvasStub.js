// Minimal stub for @napi-rs/canvas to avoid native bindings in serverless PDF parsing.
// pdfjs-dist only needs DOMMatrix, ImageData, Path2D, and createCanvas; we provide no-op versions.

class DOMMatrixStub {
  constructor(_init) {
    void _init;
  }
  multiplySelf() {
    return this;
  }
}

class ImageDataStub {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class Path2DStub {
  constructor(_path) {
    void _path;
  }
}

function createCanvas(width, height) {
  const contextStub = {
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    clearRect: () => undefined,
  };

  return {
    width,
    height,
    getContext: () => contextStub,
  };
}

const canvasStub = {
  DOMMatrix: DOMMatrixStub,
  ImageData: ImageDataStub,
  Path2D: Path2DStub,
  createCanvas,
};

module.exports = canvasStub;
module.exports.default = canvasStub;
