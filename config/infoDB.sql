SELECT `ndx`, `name`, `score`, `created`
FROM `rg_ljm_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
