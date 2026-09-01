const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const CleanCSS = require("clean-css");
const { minify } = require("html-minifier-terser");

const DIST_DIR = "dist";

const CSS_INPUT = "css/style.css";
const CSS_OUTPUT = "dist/css/style.css";

const whitelist = new Set([
  "active",
  "menu-open",

  "swiper",
  "swiper-wrapper",
  "swiper-slide",
  "swiper-pagination",
  "swiper-button-next",
  "swiper-button-prev",

  "swiperGallery",
  "swiperCertificates",

  "header__logo",
  "header__burger",
  "header__nav",
  "header__overlay",
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_DIR);
  ensureDir(path.dirname(CSS_OUTPUT));
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;

  fs.cpSync(from, to, {
    recursive: true,
  });
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) return;

  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function generateName(index) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let name = "";
  let num = index;

  do {
    name = chars[num % chars.length] + name;
    num = Math.floor(num / chars.length) - 1;
  } while (num >= 0);

  return "_" + name;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractClassesFromCss(css) {
  const classRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  const classes = new Set();

  let match;

  while ((match = classRegex.exec(css)) !== null) {
    const className = match[1];

    if (!whitelist.has(className)) {
      classes.add(className);
    }
  }

  return classes;
}

function extractClassesFromHtml(html) {
  const classAttributeRegex = /class="([^"]*)"/g;
  const classes = new Set();

  let match;

  while ((match = classAttributeRegex.exec(html)) !== null) {
    const classValue = match[1];

    classValue
      .split(/\s+/)
      .filter(Boolean)
      .forEach((className) => {
        if (!whitelist.has(className)) {
          classes.add(className);
        }
      });
  }

  return classes;
}

function replaceClassesInCss(css, classMap) {
  let result = css;

  for (const [original, obfuscated] of Object.entries(classMap)) {
    const regex = new RegExp(`\\.(${escapeRegExp(original)})(?![\\w-])`, "g");
    result = result.replace(regex, `.${obfuscated}`);
  }

  return result;
}

function replaceClassesInHtml(html, classMap) {
  return html.replace(/class="([^"]*)"/g, (fullMatch, classValue) => {
    const newClassValue = classValue
      .split(/\s+/)
      .filter(Boolean)
      .map((className) => classMap[className] || className)
      .join(" ");

    return `class="${newClassValue}"`;
  });
}

function removeCssSourceMapComment(css) {
  return css.replace(/\/\*# sourceMappingURL=.*?\*\//g, "");
}

async function build() {
  cleanDist();

  if (!fs.existsSync(CSS_INPUT)) {
    throw new Error(`CSS file not found: ${CSS_INPUT}`);
  }

  let originalCss = fs.readFileSync(CSS_INPUT, "utf8");
  originalCss = removeCssSourceMapComment(originalCss);

  const cssWithoutUrlsForExtract = protectCssUrls(originalCss).css;

  const htmlFiles = globSync("*.html");

  const allClasses = new Set();

  extractClassesFromCss(cssWithoutUrlsForExtract).forEach((className) => {
    allClasses.add(className);
  });

  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, "utf8");

    extractClassesFromHtml(html).forEach((className) => {
      allClasses.add(className);
    });
  }

  const classes = [...allClasses];

  const classMap = {};

  classes.forEach((className, index) => {
    classMap[className] = generateName(index);
  });

  const protectedCssResult = protectCssUrls(originalCss);

  const obfuscatedProtectedCss = replaceClassesInCss(
    protectedCssResult.css,
    classMap,
  );

  const obfuscatedCss = restoreCssUrls(
    obfuscatedProtectedCss,
    protectedCssResult.urls,
  );

  const minifiedCssResult = new CleanCSS({
    level: 2,
  }).minify(obfuscatedCss);

  if (minifiedCssResult.errors.length > 0) {
    console.error(minifiedCssResult.errors);
    throw new Error("CSS minification failed");
  }

  fs.writeFileSync(CSS_OUTPUT, minifiedCssResult.styles);

  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, "utf8");

    let result = replaceClassesInHtml(html, classMap);

    result = await minify(result, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
      collapseBooleanAttributes: false,
      removeAttributeQuotes: false,
    });

    fs.writeFileSync(path.join(DIST_DIR, htmlFile), result);
  }

  copyDir("img", "dist/img");
  copyDir("files", "dist/files");

  // Копируем только scripts.js, build.js НЕ копируется
  copyFile("js/scripts.js", "dist/js/scripts.js");

  copyFile("robots.txt", "dist/robots.txt");
  copyFile("sitemap.xml", "dist/sitemap.xml");

  // class-map.json создаётся в корне проекта, а НЕ в dist
  fs.writeFileSync(
    "class-map.json",
    JSON.stringify(classMap, null, 2),
  );

  console.log("Build complete.");
  console.log(`Classes obfuscated: ${Object.keys(classMap).length}`);
}

function protectCssUrls(css) {
  const urls = [];

  const protectedCss = css.replace(/url\(([^)]*)\)/g, (match) => {
    const placeholder = `___CSS_URL_${urls.length}___`;
    urls.push(match);
    return placeholder;
  });

  return {
    css: protectedCss,
    urls,
  };
}

function restoreCssUrls(css, urls) {
  let result = css;

  urls.forEach((url, index) => {
    result = result.replace(`___CSS_URL_${index}___`, url);
  });

  return result;
}

build();