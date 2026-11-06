import * as validation from './data-validation.js';
import { encodeValue, decodeValue } from './cloud-core.js';
window.promisaValidation = { ...validation, encodeValue, decodeValue };
