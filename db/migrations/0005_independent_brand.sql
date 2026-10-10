-- Independent market accounts (owner decision 2026-10-10): the brand row takes a neutral slug and
-- name, matching src/seed/brand.ts. The brand voice is the owner's text and is edited in the app.
UPDATE "brands" SET "slug" = 'main', "name" = 'Main brand', "description" = 'Culinary knowledge in Russian, published as independent market accounts.' WHERE "slug" = 'regchef';
