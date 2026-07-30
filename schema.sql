CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  result_type TEXT NOT NULL,
  answers TEXT NOT NULL,
  similar_score INTEGER NOT NULL,
  suki_score INTEGER NOT NULL,
  tpo_score INTEGER NOT NULL
);
