-- Bounded LRU cache with optional per-entry TTL. Detection needs both expiry
-- and a hard ceiling because one-off game searches may never be read again.
return function(_deps)
local M = {}

function M.new(limit)
    return { entries = {}, count = 0, limit = limit, clock = 0 }
end

function M.remove(cache, key)
    if cache.entries[key] then
        cache.entries[key] = nil
        cache.count = cache.count - 1
    end
end

function M.get(cache, key, ttl)
    local entry = cache.entries[key]
    if not entry then return nil end
    if ttl and os.time() - entry.time >= ttl then
        M.remove(cache, key)
        return nil
    end
    cache.clock = cache.clock + 1
    entry.last_used = cache.clock
    return entry
end

function M.set(cache, key, entry)
    local now = os.time()
    for cached_key, cached in pairs(cache.entries) do
        if cached.ttl and now - cached.time >= cached.ttl then M.remove(cache, cached_key) end
    end
    if not cache.entries[key] then cache.count = cache.count + 1 end
    cache.clock = cache.clock + 1
    entry.time = entry.time or now
    entry.last_used = cache.clock
    cache.entries[key] = entry
    while cache.count > cache.limit do
        local oldest_key, oldest_used = nil, math.huge
        for cached_key, cached in pairs(cache.entries) do
            if cached.last_used < oldest_used then oldest_key, oldest_used = cached_key, cached.last_used end
        end
        if not oldest_key then break end
        M.remove(cache, oldest_key)
    end
end

return M
end
