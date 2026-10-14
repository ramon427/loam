# Performance with 10,000 notes

Measured on a virtual server (Intel Haswell, 8 cores, 23 GB RAM, Linux, Node 24)
with a generated library of 10,000 notes of 8 to 30 blocks each (paragraphs,
headings, lists, links between notes, some images) in 100 folders, stored in
SQLite. Run `npm run bench` to measure your own machine; results are written to
`tmp/bench/`.

| What                                            | Time                                    |
| ----------------------------------------------- | --------------------------------------- |
| Open the library (cold start of the store)      | 272 ms                                  |
| Launch to the note list in the app              | 1.8 s                                   |
| Open a note (store)                             | 0.3 ms median                           |
| Switch notes in the app (editor shown)          | 0.2 s median                            |
| Search as you type, in the app                  | 69–88 ms to results                     |
| Search in the store, common / rare word         | 30 ms / 3.6 ms median                   |
| Backlinks of a note                             | 3.7 ms median                           |
| Import a 10,000-file Obsidian vault, in the app | 63 s, with live progress                |
| Export everything as Markdown                   | 12.4 s                                  |
| Daily backup (24 MB file)                       | 8.3 s, saves never wait more than 12 ms |
| First sync of the library to a sync folder      | 11.6 s                                  |
| A second computer takes in the whole library    | 17.7 s                                  |
| Background sync with nothing new                | 120 ms                                  |
| Turn encryption on                              | 8.3 s                                   |
| Unlock (scrypt), then open, encrypted           | 0.6 s + 0.9 s                           |
| Search in the store, encrypted, common / rare   | 23 ms / 12 ms median                    |

The database takes about 200 MB for this library.
