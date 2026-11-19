//! YouTube import helpers: playlist caps, progress mapping, and URL cleanup.
//! Network I/O stays in `main.rs`; these functions are unit-tested without yt-dlp.

pub const YOUTUBE_PLAYLIST_CAP_PRO: usize = 25;
pub const YOUTUBE_PLAYLIST_CAP_FREE: usize = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistImportPlan {
    pub urls: Vec<String>,
    pub source_count: usize,
    pub truncated: usize,
    pub warning: Option<String>,
}

/// Keep non-empty HTTP(S) URLs, in order, and apply the free/Pro playlist cap.
pub fn plan_playlist_import(urls: &[String], is_trial: bool) -> PlaylistImportPlan {
    let cleaned: Vec<String> = urls
        .iter()
        .map(|url| url.trim().to_string())
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
        .collect();
    let source_count = cleaned.len();
    let cap = if is_trial {
        YOUTUBE_PLAYLIST_CAP_FREE
    } else {
        YOUTUBE_PLAYLIST_CAP_PRO
    };
    let truncated = source_count.saturating_sub(cap);
    let urls = cleaned.into_iter().take(cap).collect();

    let warning = if source_count == 0 {
        None
    } else if is_trial && source_count > 1 {
        Some(format!(
            "Free tier imports the first video from a playlist as MP3 192kbps. Upgrade to Pro to queue up to {} videos.",
            YOUTUBE_PLAYLIST_CAP_PRO
        ))
    } else if truncated > 0 {
        Some(format!(
            "Playlist has {} videos. Importing the first {} (Pro cap).",
            source_count, cap
        ))
    } else {
        None
    };

    PlaylistImportPlan {
        urls,
        source_count,
        truncated,
        warning,
    }
}

/// Map per-item download percent (0-100) onto the overall playlist bar.
pub fn playlist_overall_percent(index: usize, total: usize, item_percent: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    let span = 100.0 / total as f64;
    let raw = (index as f64) * span + (item_percent.min(100) as f64) * span / 100.0;
    raw.floor().clamp(0.0, 100.0) as u32
}

pub fn merge_playlist_warnings(plan_warning: Option<String>, failed: usize, imported: usize) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(warning) = plan_warning {
        if !warning.trim().is_empty() {
            parts.push(warning);
        }
    }
    if failed > 0 {
        parts.push(format!(
            "Imported {imported} video(s); {failed} could not be imported."
        ));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trial_keeps_only_the_first_video_and_warns() {
        let plan = plan_playlist_import(
            &[
                " https://www.youtube.com/watch?v=aaa ".into(),
                "https://www.youtube.com/watch?v=bbb".into(),
                "not-a-url".into(),
                "".into(),
            ],
            true,
        );
        assert_eq!(plan.urls, vec!["https://www.youtube.com/watch?v=aaa"]);
        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.truncated, 1);
        assert!(plan
            .warning
            .as_deref()
            .unwrap()
            .contains("Free tier imports the first video"));
    }

    #[test]
    fn pro_caps_at_25_and_warns() {
        let urls: Vec<String> = (0..30)
            .map(|i| format!("https://www.youtube.com/watch?v={i}"))
            .collect();
        let plan = plan_playlist_import(&urls, false);
        assert_eq!(plan.urls.len(), 25);
        assert_eq!(plan.source_count, 30);
        assert_eq!(plan.truncated, 5);
        assert!(plan.warning.as_deref().unwrap().contains("30"));
    }

    #[test]
    fn pro_under_cap_has_no_warning() {
        let plan = plan_playlist_import(
            &[
                "https://www.youtube.com/watch?v=aaa".into(),
                "https://www.youtube.com/watch?v=bbb".into(),
            ],
            false,
        );
        assert_eq!(plan.urls.len(), 2);
        assert_eq!(plan.truncated, 0);
        assert_eq!(plan.warning, None);
    }

    #[test]
    fn progress_scales_across_items() {
        assert_eq!(playlist_overall_percent(0, 4, 0), 0);
        assert_eq!(playlist_overall_percent(0, 4, 100), 25);
        assert_eq!(playlist_overall_percent(1, 4, 0), 25);
        assert_eq!(playlist_overall_percent(3, 4, 100), 100);
        assert_eq!(playlist_overall_percent(0, 0, 50), 0);
    }

    #[test]
    fn warning_merge_includes_failures() {
        let merged = merge_playlist_warnings(Some("Capped.".into()), 2, 3);
        assert_eq!(
            merged.as_deref(),
            Some("Capped. Imported 3 video(s); 2 could not be imported.")
        );
        assert_eq!(merge_playlist_warnings(None, 0, 3), None);
    }
}
