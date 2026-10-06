# Historical posts import

Screen: `/knowledge/posts` (task M1-22, P1). The import reads a CSV or JSON file with your past Instagram posts and keeps one row per post, so you can annotate them and mark the best as examples of the brand voice and format.

## File

CSV (comma, semicolon or tab separated, UTF-8, with or without BOM) or JSON (a list, or an object with a `posts` list). Up to 5,000 rows and 20 MB. The first CSV row names the columns; JSON uses the same keys. Names are not case sensitive, and `_`, `-` and spaces do not matter (`hook_type`, `hookType` and `Hook Type` are the same column).

| Column | Required | Meaning |
|---|---|---|
| `external_id` | yes | The post id (Instagram media id or your own). The post is updated when this id is imported again. |
| `posted_at` | yes | `2026-03-01 10:30`, `2026-03-01` or ISO with a zone. Without a zone the time is UTC. |
| `caption` | yes | The full caption; quotes, line breaks, emojis and Russian text are fine. |
| `permalink` | – | A link starting with `http://` or `https://`. |
| `format` | – | `CAROUSEL`, `REEL`, `SINGLE_IMAGE` (also `CAROUSEL_ALBUM`, `VIDEO`, `IMAGE`). |
| `likes, comments, saves, shares, reach, views` | – | Whole numbers; `1 250` and `1,250` are read as 1250. |
| `category, angle, hook_type, cta_type` | – | Codes from the taxonomy (Settings). An unknown code rejects that row. |
| `product_code, visual_pattern` | – | Free text for now. |
| `is_exemplar` | – | `yes`/`no`, `true`/`false`, `1`/`0`, `да`/`нет`. |

Template:

```csv
external_id,permalink,posted_at,format,caption,likes,comments,saves,shares,reach,views,category,angle,hook_type,cta_type,product_code,visual_pattern,is_exemplar
18012345678901234,https://www.instagram.com/p/EXAMPLE/,2026-03-01 10:30,CAROUSEL,"Гречка без каши: 3 правила
Сохрани, чтобы не потерять",1250,34,210,45,9800,,GRAINS_RICE_PASTA,MYTH_VS_FACT,CURIOSITY_GAP,SAVE,,flatlay,yes
```

The "Import posts" dialog also offers this template as a download.

## What happens

1. The file is stored as a source of type `INSTAGRAM_POST` and job J16 `import-historical-posts` is queued.
2. Good rows are saved; bad rows are listed under "Latest imports" with the row number, the column and the reason (the file is never rejected for a bad row). A file that cannot be read at all (empty, no `external_id`/`posted_at`/`caption` columns, broken JSON, more than 5,000 rows) ends as Failed with the reason.
3. Importing the same post again updates its caption, link, date, format and the numbers the file carries. Annotations and the example flag change only where the file has a value; a row annotated in the file counts as confirmed.

Annotations you set in the screen are "Confirmed". The model's suggestions (M1-23) never overwrite confirmed ones.

## Rights

The import is stored with the rights defaults for `INSTAGRAM_POST` (Settings → Rights). A post can be marked as an example only if the import's rights do not forbid using it for prompts (`improvePrompts` is not `DENIED`, the source is not `RESTRICTED`).
