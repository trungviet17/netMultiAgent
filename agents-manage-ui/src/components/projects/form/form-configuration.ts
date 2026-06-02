import type { ProjectFormData } from './validation';

// Models are no longer pre-filled with a hardcoded provider default. The base model
// is a required field, so the user must pick from the providers configured at the org
// level (Model Providers). structuredOutput/summarizer inherit from base when left empty.
export const defaultValues: ProjectFormData = {
  id: '',
  name: '',
  description: '',
  models: {
    base: {
      model: '',
      providerOptions: undefined,
    },
    structuredOutput: {
      model: '',
      providerOptions: undefined,
    },
    summarizer: {
      model: '',
      providerOptions: undefined,
    },
  },
  stopWhen: undefined,
};
