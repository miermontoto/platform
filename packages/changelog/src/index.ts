// barrel de @platform/changelog: contrato de datos del "novedades" compartido.
// solo tipos: las entradas viven en el código de cada app y el render lo hace
// @platform/ui Changelog.svelte
export {
  type ChangelogChange,
  type ChangelogEntry,
  type ChangelogType,
} from './changelog-types.js';
