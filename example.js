import { rehype } from "rehype";
import { rehypeResponsiveImages } from "./dist/index.js";

rehype()
    .use(rehypeResponsiveImages, {
        formats: ["avif", "jpg"],
        widths: [800, 1200, 2400],
        outputDir: "./example-output/"
    })
    .process(`<img src="/example.jpg" />`)
    .then(console.log)
    .catch(console.error);

