# Diary
 PWA version of ConsoleDiary

For local file access, run a server thus:

$ cd DiaryProjectDirectory

$ http-server .

Then point a browser to http://127.0.0.1:8080/index

When searching for entries, can use "and" and "or" between terms for logical search.
Search is not case-sensitive, and will return words for which the search term is a substring.

To get round security measures preventing network directory listings, now uses a manifest.json 
file in the ./diaries folder which contains a list of all diaries. This is what is read rather
than an actual directory listing, so must keep this up to date as additional years are added.
