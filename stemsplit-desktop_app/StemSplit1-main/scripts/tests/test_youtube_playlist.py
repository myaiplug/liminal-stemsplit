from youtube_dl import collect_playlist_video_urls


def test_collects_watch_urls_and_skips_empties_and_duplicates():
    info = {
        "title": "Demo playlist",
        "entries": [
            None,
            {"id": "aaa", "title": "One"},
            {"id": "aaa", "webpage_url": "https://www.youtube.com/watch?v=aaa"},
            {"webpage_url": "https://www.youtube.com/watch?v=bbb"},
            {"url": "https://youtu.be/ccc"},
            {"url": "https://manifest.googlevideo.com/api/manifest/hls_playlist/foo"},
            {},
        ],
    }
    assert collect_playlist_video_urls(info) == [
        "https://www.youtube.com/watch?v=aaa",
        "https://www.youtube.com/watch?v=bbb",
        "https://youtu.be/ccc",
    ]


def test_single_or_empty_playlist_returns_no_batch():
    assert collect_playlist_video_urls({"entries": [{"id": "only"}]}) == [
        "https://www.youtube.com/watch?v=only"
    ]
    assert collect_playlist_video_urls({"entries": []}) == []
    assert collect_playlist_video_urls({}) == []
