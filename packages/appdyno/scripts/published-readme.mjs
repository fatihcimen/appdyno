// npm shows the README against the package's own folder, where the docs and the pictures are not.

/**
 * The README with its links to this repository's files made whole, at the release's own tag: a version's page keeps
 * that version's pictures and docs, and a doc renamed later breaks no published version's link.
 * @param {string} text
 * @param {string} repository
 * @param {string} version
 */
export const publishedReadme = (text, repository, version) => {
  const ref = `v${version}`;
  const home = repository.replace(/^git\+/, '').replace(/\.git$/, '');
  return (
    text
      .replace(/(<img[^>]* src="|<source[^>]* srcset=")(?![a-z]+:)/g, `$1${home}/raw/${ref}/`)
      .replace(/(!\[[^\]]*\]\()(?![a-z]+:)/g, `$1${home}/raw/${ref}/`)
      .replace(/(^|[^!])(\[[^\]]*\]\()(?![a-z]+:|#)/gm, `$1$2${home}/blob/${ref}/`)
      // a link around a picture, as a badge's
      .replace(/(\]\([^)\s]*\)\]\()(?![a-z]+:|#)/g, `$1${home}/blob/${ref}/`)
  );
};
