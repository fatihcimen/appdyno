// npm shows the README against the package's own folder, where the docs and the pictures are not.

/** The README with its links to this repository's files made whole. */
export const publishedReadme = (text, repository) => {
  const home = repository.replace(/^git\+/, '').replace(/\.git$/, '');
  return text
    .replace(/(<img[^>]* src=")(?![a-z]+:)/g, `$1${home}/raw/main/`)
    .replace(/(!\[[^\]]*\]\()(?![a-z]+:)/g, `$1${home}/raw/main/`)
    .replace(/(^|[^!])(\[[^\]]*\]\()(?![a-z]+:|#)/gm, `$1$2${home}/blob/main/`);
};
