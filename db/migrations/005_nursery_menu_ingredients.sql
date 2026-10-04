-- Ingredients are listed per section, never per dish. An empty value omits
-- them, and a section without a dish cannot carry ingredients.
ALTER TABLE nursery_menus
  ADD COLUMN lunch_ingredients text NOT NULL DEFAULT '',
  ADD COLUMN snack_ingredients text NOT NULL DEFAULT '',
  ADD CHECK (char_length(lunch_ingredients) <= 500),
  ADD CHECK (char_length(snack_ingredients) <= 500),
  ADD CHECK (lunch <> '' OR lunch_ingredients = ''),
  ADD CHECK (snack <> '' OR snack_ingredients = '');
