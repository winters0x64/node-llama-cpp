import {createContentLoader, defineConfig, HeadConfig} from "vitepress";
import path from "path";
import {createRequire} from "node:module";
import process from "process";
import fs from "fs-extra";
import {fileURLToPath} from "url";
import {transformerTwoslash} from "@shikijs/vitepress-twoslash";
import ts from "typescript";
import envVar from "env-var";
import {Feed} from "feed";
import {rehype} from "rehype";
import {Element as HastElement, Parent} from "hast";
import sharp from "sharp";
import {GitChangelog, GitChangelogMarkdownSection} from "@nolebase/vitepress-plugin-git-changelog/vite";
import {buildEndGenerateOpenGraphImages} from "@nolebase/vitepress-plugin-og-image/vitepress";
import {Resvg, initWasm as initResvgWasm, ResvgRenderOptions} from "@resvg/resvg-wasm";
import {BlogPageInfoPlugin} from "./config/BlogPageInfoPlugin.js";
import {getApiReferenceSidebar} from "./config/apiReferenceSidebar.js";
import {ensureLocalImage} from "./utils/ensureLocalImage.js";

import type {Node as UnistNode} from "unist";
import type {ShikiTransformer} from "shiki";


const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson: typeof import("../package.json") = fs.readJsonSync(path.join(__dirname, "..", "package.json"));
const env = envVar.from(process.env);

const urlBase = env.get("DOCS_URL_BASE")
    .asString();
const packageVersion = env.get("DOCS_PACKAGE_VERSION")
    .default(packageJson.version)
    .asString();
const googleSiteVerificationCode = "7b4Hd_giIK0EFsin6a7PWLmM_OeaC7APLZUxVGwwI6Y";

const hostname = "https://node-llama-cpp.withcat.ai/";

const socialPosterLink = hostname + "social.poster.jpg";
const defaultPageTitle = "node-llama-cpp - node.js bindings for llama.cpp";
const defaultPageDescription = "Run AI models locally on your machine with node.js bindings for llama.cpp";

function resolveHref(href: string, withDomain: boolean = false): string {
    if (withDomain) {
        const resolvedHref = resolveHref(href, false);

        if (hostname.endsWith("/") && resolvedHref.startsWith("/"))
            return hostname + resolvedHref.slice("/".length);
        else if (!hostname.endsWith("/") && !resolvedHref.startsWith("/"))
            return hostname + "/" + resolvedHref;

        return hostname + resolvedHref;
    }

    if (urlBase == null)
        return href;

    if (urlBase.endsWith("/") && href.startsWith("/"))
        return urlBase.slice(0, -1) + href;

    if (href.startsWith("http://") || href.startsWith("https://"))
        return href;

    return urlBase + href;
}

const defaultImageMetaTags: HeadConfig[] = [
    ["meta", {name: "og:image", content: socialPosterLink}],
    ["meta", {name: "og:image:width", content: "4096"}],
    ["meta", {name: "og:image:height", content: "2048"}],
    ["meta", {name: "twitter:image", content: socialPosterLink}],
    ["meta", {name: "twitter:card", content: "summary_large_image"}]
];

export default defineConfig({
    title: "node-llama-cpp",
    description: defaultPageDescription,

    srcDir: "./docs",
    outDir: "./docs-site",
    cacheDir: "./.vitepress/.cache",

    cleanUrls: true,
    lastUpdated: true,

    contentProps: {
        packageVersion
    },

    base: urlBase,
    sitemap: {
        hostname,
        transformItems(items) {
            return items.map((item) => {
                if (item.url.includes("api/") || item.url.includes("cli/")) {
                    item = {
                        ...item,
                        lastmod: undefined
                    };
                }

                return item;
            });
        }
    },
    head: [
        ["link", {rel: "icon", type: "image/svg+xml", href: resolveHref("/favicon.svg")}],
        ["link", {rel: "icon", type: "image/png", href: resolveHref("/favicon.png")}],
        ["link", {rel: "alternate", title: "Blog", type: "application/atom+xml", href: resolveHref("/blog/feed.atom", true)}],
        ["meta", {name: "theme-color", content: "#cd8156"}],
        ["meta", {name: "theme-color", content: "#dd773e", media: "(prefers-color-scheme: dark)"}],
        ["meta", {name: "og:type", content: "website"}],
        ["meta", {name: "og:locale", content: "en"}],
        ["meta", {name: "og:site_name", content: "node-llama-cpp"}],
        ["script", {async: "", src: "https://www.googletagmanager.com/gtag/js?id=G-Q2SWE5Z1ST"}],
        [
            "script",
            {},
            "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());" +
            "gtag('config','G-Q2SWE5Z1ST');"
        ],
        ["style", {}],
    ],
    async transformHead({pageData, head}) {
        if (pageData.filePath === "index.md") {
            head.push(["meta", {name: "google-site-verification", content: googleSiteVerificationCode}]);
            head.push(...defaultImageMetaTags);
        } else if (pageData.relativePath === "404.md")
            head.push(...defaultImageMetaTags);

        const title = [
            pageData.title,
            pageData.titleTemplate
        ]
            .filter(Boolean)
            .join(" - ") || defaultPageTitle;
        const description = pageData.description || defaultPageDescription;

        if (pageData.filePath.startsWith("blog/") && pageData.frontmatter.image != null) {
            let imageDir = pageData.filePath;
            if (imageDir.toLowerCase().endsWith(".md"))
                imageDir = imageDir.slice(0, -".md".length);

            if (typeof pageData.frontmatter.image === "string") {
                const coverImage = await ensureLocalImage(pageData.frontmatter.image, "cover", {
                    baseDestLocation: imageDir.split("/")
                });
                head.push(["meta", {name: "og:image", content: resolveHref(coverImage.urlPath.absolute, true)}]);
            } else if (typeof pageData.frontmatter.image === "object") {
                const coverImage = typeof pageData.frontmatter.image.url === "string"
                    ? await ensureLocalImage(pageData.frontmatter.image.url, "cover", {
                        baseDestLocation: imageDir.split("/")
                    })
                    : undefined;

                if (typeof pageData.frontmatter.image.url === "string")
                    head.push(["meta", {
                        name: "og:image",
                        content: resolveHref(coverImage?.urlPath.absolute ?? pageData.frontmatter.image.url, true)
                    }]);

                if (pageData.frontmatter.image.width != null)
                    head.push(["meta", {
                        name: "og:image:width",
                        content: String(coverImage?.width ?? pageData.frontmatter.image.width)
                    }]);

                if (pageData.frontmatter.image.height != null)
                    head.push(["meta", {
                        name: "og:image:height",
                        content: String(coverImage?.height ?? pageData.frontmatter.image.height)
                    }]);
            }
        }

        head.push(["meta", {name: "og:title", content: title}]);
        head.push(["meta", {name: "og:description", content: description}]);
        head.push(["meta", {name: "twitter:title", content: title}]);
        head.push(["meta", {name: "twitter:description", content: description}]);
    },
    transformPageData(pageData) {
        if (pageData.filePath.startsWith("api/")) {
            pageData.frontmatter.editLink = false;
            pageData.frontmatter.lastUpdated = false;
            pageData.frontmatter ||= {};
            pageData.frontmatter.outline = [2, 3];
            pageData.frontmatter.nolebase = {
                gitChangelog: false
            };
        }

        if (pageData.filePath.startsWith("cli/")) {
            pageData.frontmatter.editLink = false;
            pageData.frontmatter.lastUpdated = false;
            pageData.frontmatter.nolebase = {
                gitChangelog: false
            };
        }

        if (pageData.filePath.startsWith("blog/")) {
            pageData.frontmatter.editLink = false;
            pageData.frontmatter.aside = false;
            pageData.frontmatter.outline = false
            pageData.frontmatter.nolebase = {
                gitChangelog: false
            };
        }

        let canonicalUrl = hostname + pageData.relativePath;
        if (canonicalUrl.endsWith("/index.html"))
            canonicalUrl = canonicalUrl.slice(0, -"index.html".length);
        if (canonicalUrl.endsWith("/index.md"))
            canonicalUrl = canonicalUrl.slice(0, -"index.md".length);
        else if (canonicalUrl.endsWith(".html"))
            canonicalUrl = canonicalUrl.slice(0, -".html".length);
        else if (canonicalUrl.endsWith(".md"))
            canonicalUrl = canonicalUrl.slice(0, -".md".length);

        pageData.frontmatter.head ??= [];
        pageData.frontmatter.head.push([
            "link",
            {rel: "canonical", href: canonicalUrl},
            {rel: "giscus:backlink", href: canonicalUrl}
        ]);
    },
    vite: {
        plugins: [
            GitChangelog({
                repoURL: () => "https://github.com/withcatai/node-llama-cpp",
                cwd: path.join(__dirname, "..", "docs")
            }),
            GitChangelogMarkdownSection({
                exclude: (id) => (
                    id.includes(path.sep + "api" + path.sep) ||
                    id.includes(path.sep + "cli" + path.sep) ||
                    id.includes(path.sep + "blog" + path.sep)
                ),
                sections: {
                    disableContributors: true
                }
            }),
            BlogPageInfoPlugin({
                include: (id) => id.includes(path.sep + "blog" + path.sep) && !id.endsWith(path.sep + "blog" + path.sep + "index.md")
            })
        ],
        build: {
            rollupOptions: {
                external: ["/logo.preview.avif"]
            }
        }
    },
    markdown: {
        codeTransformers: [
            transformerTwoslash({
                explicitTrigger: false,
                filter(lang, code, options) {
                    return options.lang?.toLowerCase() === "typescript";
                },
                twoslashOptions: {
                    compilerOptions: {
                        ...(await fs.readJSON(path.join(__dirname, "..", "tsconfig.json"))).compilerOptions,
                        moduleResolution: undefined,
                        paths: {
                            "node-llama-cpp": [
                                path.resolve(__dirname, "..", "dist", "index.d.ts"),
                                path.resolve(__dirname, "..", "src", "index.ts")
                            ],
                            "node-llama-cpp/commands": [
                                path.resolve(__dirname, "..", "dist", "commands.d.ts"),
                                path.resolve(__dirname, "..", "src", "commands.ts")
                            ]
                        },
                        typeRoots: [
                            path.resolve(__dirname, "..", "node_modules"),
                            path.resolve(__dirname, "..", "node_modules", "@types")
                        ],
                        module: ts.ModuleKind.ES2022,
                        target: ts.ScriptTarget.ES2022,
                        moduleDetection: ts.ModuleDetectionKind.Force
                    },
                    tsModule: ts
                }
            }) as ShikiTransformer
        ]
    },
    themeConfig: {
        editLink: {
            pattern: "https://github.com/withcatai/node-llama-cpp/edit/master/docs/:path"
        },
        nav: [
            {text: "Guide", link: "/guide/", activeMatch: "/guide/"},
            {text: "CLI", link: "/cli/", activeMatch: "/cli/"},
            {text: "API Reference", link: "/api/functions/getLlama", activeMatch: "/api/"},
            {text: "Blog", link: "/blog/", activeMatch: "/blog/"},
            {
                text: packageVersion,
                items: [{
                    text: "Changelog",
                    link: "https://github.com/withcatai/node-llama-cpp/releases"
                }, {
                    text: "Roadmap",
                    link: "https://github.com/orgs/withcatai/projects/1"
                }, {
                    text: "npm",
                    link: "https://www.npmjs.com/package/node-llama-cpp"
                }, {
                    text: "GitHub Discussions",
                    link: "https://github.com/withcatai/node-llama-cpp/discussions"
                }, {
                    text: "Contribute",
                    link: "/guide/contributing"
                },
                ...(
                    packageJson?.funding?.url == null
                        ? []
                        : [{
                            text: "Sponsor",
                            link: packageJson?.funding?.url
                        }]
                )]
            }
        ],
        search: {
            provider: "local",
            options: {
                detailedView: true,
                miniSearch: {
                    searchOptions: {
                        boostDocument(term, documentId, storedFields) {
                            const firstTitle = (storedFields?.titles as string[])?.[0];
                            if (firstTitle?.startsWith("Type Alias: "))
                                return -0.8;
                            else if (firstTitle?.startsWith("Class: "))
                                return -0.9;
                            else if (firstTitle?.startsWith("Function: "))
                                return -0.95;

                            return 1;
                        }
                    }
                }
            }
        },
        sidebar: {
            "/api/": getApiReferenceSidebar(),

            "/guide/": [{
                text: "Guide",
                base: "/guide",
                items: [
                    {text: "Getting Started", link: "/"},
                    {text: "Chat Session", link: "/chat-session"},
                    {text: "Chat Wrapper", link: "/chat-wrapper"},
                    {text: "Grammar", link: "/grammar"},
                    {text: "Function Calling", link: "/function-calling"},
                    {text: "Embedding", link: "/embedding"},
                    {text: "Text Completion", link: "/text-completion"},
                    {text: "Choosing a Model", link: "/choosing-a-model"},
                    {text: "Downloading Models", link: "/downloading-models"}
                ]
            }, {
                text: "Advanced",
                base: "/guide",
                items: [
                    {text: "Building From Source", link: "/building-from-source"},
                    {text: "Metal Support", link: "/Metal"},
                    {text: "CUDA Support", link: "/CUDA"},
                    {text: "Vulkan Support", link: "/Vulkan"},
                    {text: "Electron Support", link: "/electron"},
                    {text: "Using in Docker", link: "/docker"},
                    {text: "Using Tokens", link: "/tokens"},
                    {text: "LlamaText", link: "/llama-text"},
                    {text: "External Chat State", link: "/external-chat-state"},
                    {text: "Token Bias", link: "/token-bias"},
                    {text: "Objects Lifecycle", link: "/objects-lifecycle"},
                    {text: "Batching", link: "/batching"},
                    {text: "Awesome List", link: "/awesome"},
                    {text: "Troubleshooting", link: "/troubleshooting"},
                    {text: "Tips and Tricks", link: "/tips-and-tricks"}
                ]
            }, {
                text: "Contributing",
                base: "/guide",
                items: [
                    {text: "Setting Up a Dev Environment", link: "/development"},
                    {text: "Pull Request Guidelines", link: "/contributing"}
                ]
            }],

            "/cli/": [{
                text: "CLI",
                base: "/cli",
                link: "/",
                items: [
                    {text: "Init", link: "/init"},
                    {text: "Chat", link: "/chat"},
                    {text: "Pull", link: "/pull"},
                    {
                        text: "Source",
                        link: "/source",
                        collapsed: true,
                        items: [
                            {text: "Download", link: "/source/download"},
                            {text: "Build", link: "/source/build"},
                            {text: "Clear", link: "/source/clear"}
                        ]
                    },
                    {text: "Complete", link: "/complete"},
                    {text: "Infill", link: "/infill"},
                    {
                        text: "Inspect",
                        link: "/inspect",
                        collapsed: true,
                        items: [
                            {text: "GPU", link: "/inspect/gpu"},
                            {text: "GGUF", link: "/inspect/gguf"},
                            {text: "Measure", link: "/inspect/measure"},
                            {text: "Estimate", link: "/inspect/estimate"}
                        ]
                    }
                ]
            }]
        },
        socialLinks: [
            {icon: "npm", link: "https://www.npmjs.com/package/node-llama-cpp"},
            {icon: "github", link: "https://github.com/withcatai/node-llama-cpp"}
        ]
    },
    async buildEnd(siteConfig) {
        const blogPosts = await createContentLoader("blog/*.md", {
            excerpt: true,
            render: true
        })
            .load();

        async function loadSvgFontBuffers() {
            const interFontFilesDirectoryPath = path.join(require.resolve("@fontsource/inter"), "..", "files");
            const interFontFilePaths = [
                "inter-latin-400-normal.woff2",
                "inter-latin-500-normal.woff2",
                "inter-latin-600-normal.woff2",
                "inter-latin-700-normal.woff2",
                "inter-latin-ext-400-normal.woff2",
                "inter-latin-ext-500-normal.woff2",
                "inter-latin-ext-600-normal.woff2",
                "inter-latin-ext-700-normal.woff2",
            ];

            return await Promise.all(
                interFontFilePaths.map((filename) => (
                    fs.readFile(path.join(interFontFilesDirectoryPath, filename))
                ))
            );
        }

        async function loadInnerSvgImages() {
            const svgImages: Record<string, Buffer> = {
                "https://raw.githubusercontent.com/withcatai/node-llama-cpp/master/assets/logo.v3.roundEdges.png":
                    await fs.readFile(path.join(__dirname, "..", "assets", "logo.v3.roundEdges.png")),
                "https://raw.githubusercontent.com/withcatai/node-llama-cpp/master/assets/logo.v3.png":
                    await fs.readFile(path.join(__dirname, "..", "assets", "logo.v3.png"))
            };

            return svgImages;
        }

        const svgFontBuffers = loadSvgFontBuffers();
        const innerSvgImages = loadInnerSvgImages();

        async function renderSvg(svgPath: string, destPngPath: string, options: ResvgRenderOptions) {
            console.info(`Rendering "${svgPath}" to "${destPngPath}"`)

            const svgContent = await fs.readFile(svgPath, "utf8");
            const svgImages = await innerSvgImages;

            const resvg = new Resvg(svgContent, {
                ...(options ?? {}),
                font: {
                    ...(options.font ?? {}),
                    fontBuffers: await svgFontBuffers,
                    loadSystemFonts: false
                }
            });

            for (const url of resvg.imagesToResolve()) {
                if (svgImages[url] != null)
                    resvg.resolveImage(url, svgImages[url]);
                else {
                    console.info(`Fetching image: "${url}" for SVG "${svgPath}"`);
                    const fetchRes = await fetch(url);
                    if (!fetchRes.ok)
                        throw new Error(`Failed to fetch image: ${url}`);

                    resvg.resolveImage(url, Buffer.from(await fetchRes.arrayBuffer()));
                }
            }

            const res = resvg.render();

            await fs.writeFile(destPngPath, res.asPng(), "binary");
        }

        async function convertPngToJpg(pngPath: string, jpgPath: string, quality: number = 75) {
            console.info(`Converting "${pngPath}" to "${jpgPath}" with quality ${quality}`);

            const pngBuffer = await fs.readFile(pngPath);
            const jpgBuffer = await sharp(pngBuffer)
                .jpeg({quality})
                .toBuffer();

            await fs.writeFile(jpgPath, jpgBuffer, "binary");
        }

        async function convertPngToPreviewAvif(pngPath: string, avifPath: string, quality: number = 24, maxSize: number = 640) {
            console.info(`Converting "${pngPath}" to "${avifPath}" with quality ${quality}`);

            const pngBuffer = await fs.readFile(pngPath);
            const avifBuffer = await sharp(pngBuffer)
                .resize({
                    width: maxSize,
                    height: maxSize,
                    fit: "outside",
                    withoutEnlargement: true
                })
                .avif({
                    quality,
                    effort: 9
                })
                .toBuffer();

            await fs.writeFile(avifPath, avifBuffer, "binary");
        }

        async function addOgImages() {
            const svgImages = await innerSvgImages;

            let baseUrl = resolveHref("", true);
            if (baseUrl.endsWith("/"))
                baseUrl = baseUrl.slice(0, -"/".length);

            await buildEndGenerateOpenGraphImages({
                baseUrl,
                category: {
                    byCustomGetter(page) {
                        if (page.link?.startsWith("/api/")) return "API";
                        if (page.link?.startsWith("/guide/")) return "Guide";
                        if (page.link?.startsWith("/cli/")) return "CLI";
                        if (page.link === "/blog/") return " ";
                        if (page.link?.startsWith("/blog/")) return "Blog";

                        return " ";
                    }
                },
                async svgImageUrlResolver(imageUrl: string) {
                    if (svgImages[imageUrl] != null)
                        return svgImages[imageUrl];

                    throw new Error(`Unknown SVG image URL: ${imageUrl}`);
                },
                svgFontBuffers: await svgFontBuffers,
                templateSvgPath: path.join(__dirname, "assets", "ogTemplate.svg"),
                resultImageWidth: 1200,
                maxCharactersPerLine: 20,
                overrideExistingMetaTags: false
            })({
                ...siteConfig,
                site: {
                    ...siteConfig.site,
                    themeConfig: {
                        ...siteConfig.site.themeConfig,
                        sidebar: {
                            ...siteConfig.site.themeConfig.sidebar,
                            "/_blog/": {
                                text: "Blog",
                                link: "/blog/",
                                items: blogPosts.map((post) => ({
                                    text: post.frontmatter.title,
                                    link: post.url
                                }))
                            }
                        }
                    }
                }
            });
        }

        async function addBlogRssFeed() {
            const feedFilePath = path.join(siteConfig.outDir, "blog", "feed.atom");

            const feed = new Feed({
                title: "node-llama-cpp",
                description: "Run AI models locally on your machine",
                id: hostname,
                link: hostname,
                language: "en",
                image: socialPosterLink,
                favicon: resolveHref("/favicon.ico", true),
                copyright: "node-llama-cpp",
                generator: "node-llama-cpp",
                feed: resolveHref("/blog/feed.atom", true),
                author: {
                    name: typeof packageJson.author === "string"
                        ? packageJson.author
                        : (packageJson.author as undefined | { name?: string })?.name
                },
                hub: "https://pubsubhubbub.appspot.com/"
            });

            blogPosts.sort((a, b) => {
                const aDate = a.frontmatter.date
                    ? new Date(a.frontmatter.date)
                    : null;
                const bDate = b.frontmatter.date
                    ? new Date(b.frontmatter.date)
                    : null;

                if (aDate == null)
                    return -1;
                if (bDate == null)
                    return 1;

                return bDate.getTime() - aDate.getTime();
            });

            for (const {url, excerpt, frontmatter, html} of blogPosts) {
                const ogImageElement = findElementInHtml(html, (element) => element.tagName === "meta" && element.properties?.name === "og:imag");
                const date = new Date(frontmatter.date);
                if (Number.isNaN(date.getTime()))
                    throw new Error(`Invalid date for blog post: ${url}`);
                else if (frontmatter.title == null || frontmatter.title === "")
                    throw new Error(`Invalid title for blog post: ${url}`);

                feed.addItem({
                    title: frontmatter.title,
                    id: resolveHref(url, true),
                    link: resolveHref(url, true),
                    description: excerpt || frontmatter.description || undefined,
                    content: html,
                    author: [{
                        name: frontmatter.author?.name,
                        link: frontmatter.author?.link != null
                            ? frontmatter.author?.link
                            : frontmatter.author?.github != null
                                ? `https://github.com/${frontmatter.author.github}`
                                : undefined,
                        email: frontmatter.author?.github != null
                            ? (
                                frontmatter.author?.github +
                                "@users.noreply.github.com" + (
                                    frontmatter.author?.name != null
                                        ? ` (${frontmatter.author.name})`
                                        : ""
                                )
                            )
                            : undefined
                    }],
                    published: date,
                    date: date,
                    image: ogImageElement?.properties?.content as string | undefined,
                    category: typeof frontmatter.category === "string"
                        ? [{term: frontmatter.category}]
                        : frontmatter.category instanceof Array
                            ? frontmatter.category.map((category: string) => ({term: category}))
                            : frontmatter.categories instanceof Array
                                ? frontmatter.categories.map((category: string) => ({term: category}))
                                : undefined
                });
            }

            await fs.writeFile(feedFilePath, feed.atom1());
        }

        await addOgImages();

        const indexPageIndex = blogPosts.findIndex((post) => post.url === "/blog/");
        if (indexPageIndex < 0)
            throw new Error("Blog index page not found");

        blogPosts.splice(indexPageIndex, 1);

        await addBlogRssFeed();

        try {
            await initResvgWasm(await fs.readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
        } catch (err) {
            // do nothing if wasm is already loaded
        }

        await renderSvg(
            path.join(__dirname, "assets", "social.poster.svg"),
            path.join(siteConfig.outDir, "social.poster.png"),
            {
                fitTo: {
                    mode: "height",
                    value: 2048
                }
            }
        );
        await convertPngToJpg(
            path.join(siteConfig.outDir, "social.poster.png"),
            path.join(siteConfig.outDir, "social.poster.jpg"),
            75
        );
        await convertPngToPreviewAvif(
            path.join(__dirname, "..", "assets", "logo.v3.png"),
            path.join(siteConfig.outDir, "logo.preview.avif"),
            24
        );
    }
});

function findElementInHtml(html: string | undefined, matcher: (element: HastElement) => boolean) {
    function isElement(node: UnistNode): node is HastElement {
        return node.type === "element";
    }

    function isParent(node: UnistNode): node is Parent {
        return node.type === "element" || node.type === "root";
    }

    if (html == null)
        return undefined;

    const parsedHtml = rehype()
        .parse(html);

    const queue: Parent[] = [parsedHtml];
    while (queue.length > 0) {
        const item = queue.shift();
        if (item == null)
            continue;

        if (isElement(item) && matcher(item))
            return item;

        if (item.children == null)
            continue;

        for (let i = 0; i < item.children.length; i++) {
            const child = item.children[i]!;

            if (isParent(child))
                queue.push(child);
        }
    }

    return undefined;
}

