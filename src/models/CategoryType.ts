export enum CategoryType {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  OTHER = 'other'
}

export function normalizeCategory(input: string | null | undefined): CategoryType {
  if (!input || typeof input !== 'string') {
    return CategoryType.OTHER;
  }
  
  const normalized = input.toLowerCase().trim();
  
  switch (normalized) {
  case 'primary':
    return CategoryType.PRIMARY;
  case 'secondary':
    return CategoryType.SECONDARY;
  case 'other':
    return CategoryType.OTHER;
  default:
    return CategoryType.OTHER;
  }
}

export function validateCategory(input: string | null | undefined): CategoryType {
  return normalizeCategory(input);
}