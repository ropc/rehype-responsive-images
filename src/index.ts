import type { Plugin, Transformer } from "unified";
import type { Root, Element } from "hast";
import { h } from "hastscript";
import { SKIP, visit } from "unist-util-visit";
import { is } from "unist-util-is";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import createDebug from "debug";

const debug = createDebug("RehypeResponsiveImages");

type ImageFormat = "avif" | "webp" | "jpg" | "png";

const imageFormatComparator = (a: ImageFormat, b: ImageFormat) => {
    if (a === b) {
        return 0;
    } else if (a === "jpg") {
        return -1;
    } else {
        return 1;
    }
}

interface Settings {
    readonly formats: ImageFormat[];
    readonly widths: number[];
    readonly outputDir: string;
    readonly inputDir: string;
}

const DEFAULT_SETTINGS: Settings = {
    formats: ["jpg"],
    widths: [800, 1280, 2400],
    outputDir: "./",
    inputDir: "./",
};

interface ImageData {
    url: string;
    width: number;
    format: ImageFormat;
}

const resizedImages = (originalPath: string, originalWidth: number, format: ImageFormat, widths: number[]): ImageData[] => {
    const { dir, name, ext } = path.parse(originalPath);
    const baseOuputPath = path.join(dir, name);
    return widths.filter(width => width < originalWidth || toMIMEType(ext) !== toMIMEType(format))
        .map(width => ({ width, format, url: `${baseOuputPath}-${width}w.${format}` }));
}

const toMIMEType = (format: string) => {
    // TODO: make a better version of this
    return `image/${format}`;
}

export const rehypeResponsiveImages: Plugin<[Partial<Settings>], Root> = (userSettings) => {
    const settings: Settings = {...DEFAULT_SETTINGS, ...userSettings};

    return (hast) => {
        const imagesToResize: {source: string, targets: ImageData[]}[] = [];

        // goes through tree, replacing all img nodes with picture nodes
        // and corresponding source/img child nodes
        // keeps track of images that need to be resized in imagesToResize
        visit(hast, ["element"], (node) => {
            if (!is<Element>(node, "element")
                || node.tagName !== "img"
                || typeof node.properties?.src !== "string") {
                return;
            }

            // const originalPath = path.join(settings.inputDir, node.properties.src);
            const nodeSrc = node.properties?.src;
            const originalDimensions = {
                width: 4000,
                height: 3000,
            };
            const originalNodeProperties = {...node.properties};

            const hWithSrcSet = (tagName: string, format: ImageFormat, images: ImageData[]) => {
                const srcSet = images.filter(image => image.format === format)
                    .map(({ width, url }) => `${url} ${width}w`)
                    .join(', ');
                return h(tagName, {
                    ...originalNodeProperties,
                    src: tagName == "source" ? undefined : originalNodeProperties.src,
                    srcSet,
                    type: toMIMEType(format)
                });
            }

            const [imgFormat, ...sourceFormats] = settings.formats.sort(imageFormatComparator);
            const newImages = settings.formats
                .flatMap(format => resizedImages(nodeSrc, originalDimensions.width, format, settings.widths.sort()));

            imagesToResize.push({ source: path.join(settings.inputDir, node.properties.src), targets: newImages })

            // const picture = h("picture", [
            //     ...sourceFormats.map(format => hWithSrcSet("source", format, newImages)),
            //     hWithSrcSet("img", imgFormat, newImages),
            // ]);

            node.tagName = "picture";
            node.properties = {};
            node.children = [
                ...sourceFormats.map(format => hWithSrcSet("source", format, newImages)),
                hWithSrcSet("img", imgFormat, newImages),
            ];
            return SKIP;

            // if (parent && index) {
            //     parent.children[index] = picture;
            //     return SKIP;
            // } else {
            //     // edge case where no parent exists
            // }
        });

        debug("images", imagesToResize);

        const newImagesToResize = imagesToResize
            .flatMap(({source, targets}) => {
                // groups targets by width, so that sharp can resize once to each width
                const targetsByWidth = new Map<number, ImageData[]>();
                targets.filter(img => !fs.existsSync(path.join(settings.outputDir, img.url)))  // filter out existing files
                    .forEach(target => {
                        targetsByWidth.set(target.width, [...(targetsByWidth.get(target.width) || []), target])
                    })
                return Array.from(targetsByWidth.entries())
                    .map(([width, targets]) => ({ source, targets, width }))
            })
            .filter(({ targets }) => targets.length > 0);

        const dirnames = new Set(newImagesToResize.flatMap(data => data.targets).map(target => path.dirname(path.join(settings.outputDir, target.url))))
        dirnames.forEach(dirname => fs.existsSync(dirname) || fs.mkdirSync(dirname, { recursive: true }))

        const promises = newImagesToResize.flatMap(({source, targets, width}) => {
                const resized = sharp(source).resize({ width });
                return targets.map(target => resized.clone().toFile(path.join(settings.outputDir, target.url)))
            });
        
        debug("promises", promises);

        return Promise.all(promises).then(debug);  // no need to return anything from promise
    };
};

export default rehypeResponsiveImages;
