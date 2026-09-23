// Loads the project-root .env (e.g. WIKI_SKILL_CONTACT) for live tests.
// Unit tests do not load it: they must not depend on local configuration.
import { loadDotEnv } from '../../src/config.js';

loadDotEnv();
