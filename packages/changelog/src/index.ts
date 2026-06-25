// barrel de @platform/changelog: changelog "novedades" compartido (tablas + servicio)
export {
  defineChangelogTable,
  defineChangelogSeenTable,
  defineChangelogSeenTableText,
  type AnyChangelogSeenTable,
  type ChangelogSeenTable,
  type ChangelogSeenTableText,
  type ChangelogTable,
} from './changelog-table.js';
export {
  createChangelogService,
  type ChangelogService,
  type ChangelogServiceOptions,
} from './changelog-service.js';
export {
  type ChangelogChange,
  type ChangelogEntry,
  type ChangelogEntryInput,
  type ChangelogState,
  type ChangelogType,
} from './changelog-types.js';
