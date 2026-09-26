export interface Sprite {
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function atlas(url: string, cols: number, rows: number): Promise<Sprite[][]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      const result: Sprite[][] = [];
      for (let row = 0; row < rows; row++) {
        const sprites: Sprite[] = [];
        for (let col = 0; col < cols; col++) {
          const x0 = Math.floor((col * image.width) / cols);
          const y0 = Math.floor((row * image.height) / rows);
          const x1 = Math.floor(((col + 1) * image.width) / cols);
          const y1 = Math.floor(((row + 1) * image.height) / rows);
          let left = x1;
          let right = x0;
          let top = y1;
          let bottom = y0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++)
              if (pixels[(y * image.width + x) * 4 + 3] > 80) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              }
          sprites.push({
            image,
            x: left,
            y: top,
            width: Math.max(1, right - left + 1),
            height: Math.max(1, bottom - top + 1),
          });
        }
        result.push(sprites);
      }
      resolve(result);
    };
    image.onerror = () => reject(new Error(`Could not load sprite atlas ${url}`));
    image.src = url;
  });
}
