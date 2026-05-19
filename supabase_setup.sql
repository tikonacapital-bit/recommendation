-- Run this once in the Supabase SQL editor before app initialization.
create extension if not exists vector;

-- Optional sanity check. It should return one row with extname = 'vector'.
select extname, extversion
from pg_extension
where extname = 'vector';
