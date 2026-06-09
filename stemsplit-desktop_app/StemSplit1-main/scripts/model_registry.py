"""
Model variant registry — maps Liminal catalog IDs to backend routing.
Models marked audio_separator auto-download via python-audio-separator on first use.
"""

from typing import Any, Dict

MODEL_VARIANTS: Dict[str, Dict[str, Any]] = {
    # ── Demucs ──────────────────────────────────────────────
    'demucs_htdemucs': {'backend': 'demucs', 'model': 'htdemucs'},
    'demucs_htdemucs_ft': {'backend': 'demucs', 'model': 'htdemucs_ft'},
    'demucs_htdemucs_6s': {'backend': 'demucs', 'model': 'htdemucs_6s'},
    'demucs_vocals_2023': {
        'backend': 'audio_separator',
        'filename': 'model_vocals_htdemucs_sdr_8.78.ckpt',
        'engine': 'roformer',
        'msst_bundle': 'model_vocals_htdemucs_sdr_8.78.ckpt',
    },

    # ── MVSEP / MDX ─────────────────────────────────────────
    'mdx23_ensemble': {'backend': 'mvsep'},
    'mdx_kim_vocal_2': {'backend': 'audio_separator', 'filename': 'Kim_Vocal_2.onnx', 'engine': 'mdx_net'},
    'mdx_voc_ft': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET-Voc_FT.onnx', 'engine': 'mdx_net'},
    'mdx_inst_hq_1': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET-Inst_HQ_1.onnx', 'engine': 'mdx_net'},
    'mdx_inst_hq_3': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET-Inst_HQ_3.onnx', 'engine': 'mdx_net'},
    'mdx_inst_hq_4': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET-Inst_HQ_4.onnx', 'engine': 'mdx_net'},
    'mdx_inst_hq_5': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET-Inst_HQ_5.onnx', 'engine': 'mdx_net'},
    'mdx_kara': {'backend': 'audio_separator', 'filename': 'UVR_MDXNET_KARA.onnx', 'engine': 'mdx_net'},
    'mdx_kara_2': {'backend': 'audio_separator', 'filename': 'UVR_MDXNET_KARA_2.onnx', 'engine': 'mdx_net'},
    'mdx_crowd_hq': {'backend': 'audio_separator', 'filename': 'UVR-MDX-NET_Crowd_HQ_1.onnx', 'engine': 'mdx_net'},
    'mdx_crowd_roformer_2025': {
        'backend': 'audio_separator',
        'filename': 'mel_band_roformer_crowd_aufr33_viperx_sdr_8.7144.ckpt',
        'engine': 'mdx_net',
    },
    'mdx_reverb_hq': {'backend': 'audio_separator', 'filename': 'Reverb_HQ_By_FoxJoy.onnx', 'engine': 'mdx_net'},
    'mdx23c_hq': {'backend': 'audio_separator', 'filename': 'MDX23C-8KFFT-InstVoc_HQ.ckpt', 'engine': 'mdx_net'},
    'mdx23c_8k_v2': {
        'backend': 'audio_separator',
        'filename': 'model_mdx23c_ep_168_sdr_7.0207.ckpt',
        'engine': 'mdx_net',
        'msst_bundle': 'model_mdx23c_ep_168_sdr_7.0207.ckpt',
    },

    # ── Roformer SOTA ───────────────────────────────────────
    'roformer_melband': {
        'backend': 'audio_separator',
        'filename': 'vocals_mel_band_roformer.ckpt',
        'engine': 'roformer',
        'aliases': ['MelBandRoformer.ckpt', 'mel_band_roformer_kim_ft_erika.ckpt'],
    },
    'roformer_bs_317': {'backend': 'audio_separator', 'filename': 'model_bs_roformer_ep_317_sdr_12.9755.ckpt', 'engine': 'roformer'},
    'roformer_bs_368': {'backend': 'audio_separator', 'filename': 'model_bs_roformer_ep_368_sdr_12.9628.ckpt', 'engine': 'roformer'},
    'roformer_polarformer': {
        'backend': 'audio_separator',
        'filename': 'model_bs_polarformer_float16.ckpt',
        'engine': 'roformer',
        'msst_bundle': 'model_bs_polarformer_float16.ckpt',
    },
    'roformer_melband_unwa': {'backend': 'audio_separator', 'filename': 'mel_band_roformer_kim_ft_unwa.ckpt', 'engine': 'roformer'},
    'roformer_melband_big_beta4': {'backend': 'audio_separator', 'filename': 'melband_roformer_big_beta4.ckpt', 'engine': 'roformer'},
    'roformer_hyperace_v2_vocals': {
        'backend': 'audio_separator',
        'filename': 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
        'engine': 'roformer',
        'note': 'HyperACE v2 vocal profile — use BS 368+ when available in cache',
    },
    'roformer_hyperace_v2_instrum': {
        'backend': 'audio_separator',
        'filename': 'model_bs_roformer_ep_368_sdr_12.9628.ckpt',
        'engine': 'roformer',
        'note': 'HyperACE v2 instrumental profile',
    },
    'roformer_dereverb_anvuew': {
        'backend': 'audio_separator',
        'filename': 'dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt',
        'engine': 'roformer',
    },
    'roformer_bs_sw_6s': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'roformer',
        'stems': ['vocals', 'bass', 'drums', 'guitar', 'piano', 'other'],
        'note': 'jarredou BS-Roformer SW — 6-stem guitar/piano SOTA',
    },

    # ── SCNet ───────────────────────────────────────────────
    'scnet_xl_ihf': {
        'backend': 'audio_separator',
        'filename': 'model_scnet_ep_36_sdr_10.0891.ckpt',
        'engine': 'roformer',
        'msst_bundle': 'model_scnet_ep_36_sdr_10.0891.ckpt',
    },
    'scnet_xl': {
        'backend': 'audio_separator',
        'filename': 'model_scnet_ep_54_sdr_9.8051.ckpt',
        'engine': 'roformer',
        'msst_bundle': 'model_scnet_ep_54_sdr_9.8051.ckpt',
    },
    'scnet_large': {
        'backend': 'audio_separator',
        'filename': 'model_scnet_sdr_9.3244.ckpt',
        'engine': 'roformer',
        'msst_bundle': 'model_scnet_sdr_9.3244.ckpt',
    },

    # ── Ensemble presets (audio-separator) ──────────────────
    'ensemble_vocal_balanced': {'backend': 'ensemble', 'preset': 'vocal_balanced'},
    'ensemble_vocal_clean': {'backend': 'ensemble', 'preset': 'vocal_clean'},
    'ensemble_vocal_full': {'backend': 'ensemble', 'preset': 'vocal_full'},
    'ensemble_vocal_rvc': {'backend': 'ensemble', 'preset': 'vocal_rvc'},
    'ensemble_karaoke': {'backend': 'ensemble', 'preset': 'karaoke'},
    'ensemble_instrumental_clean': {'backend': 'ensemble', 'preset': 'instrumental_clean'},
    'ensemble_instrumental_full': {'backend': 'ensemble', 'preset': 'instrumental_full'},
    'ensemble_instrumental_balanced': {'backend': 'ensemble', 'preset': 'instrumental_balanced'},

    # ── Karaoke lead/back ───────────────────────────────────
    'karaoke_mvsep_team': {
        'backend': 'ensemble',
        'preset': 'karaoke',
        'stems': ['lead', 'back', 'instrumental'],
    },
    'karaoke_bs_roformer': {
        'backend': 'audio_separator',
        'filename': 'UVR_MDXNET_KARA_2.onnx',
        'engine': 'karaoke',
    },

    # ── VR ──────────────────────────────────────────────────
    'vr_hp_vocal_4': {'backend': 'audio_separator', 'filename': '4_HP-Vocal-UVR.pth', 'engine': 'vr'},
    'vr_hp_vocal_3': {'backend': 'audio_separator', 'filename': '3_HP-Vocal-UVR.pth', 'engine': 'vr'},
    'vr_hp2': {'backend': 'audio_separator', 'filename': '7_HP2-UVR.pth', 'engine': 'vr'},
    'vr_karaoke_5': {'backend': 'audio_separator', 'filename': '5_HP-Karaoke-UVR.pth', 'engine': 'vr'},
    'vr_karaoke_6': {'backend': 'audio_separator', 'filename': '6_HP-Karaoke-UVR.pth', 'engine': 'vr'},
    'vr_mgm_main': {'backend': 'audio_separator', 'filename': 'MGM_MAIN_v4.pth', 'engine': 'vr'},
    'vr_mgm_highend': {'backend': 'audio_separator', 'filename': 'MGM_HIGHEND_v4.pth', 'engine': 'vr'},
    'vr_mgm_lowend_a': {'backend': 'audio_separator', 'filename': 'MGM_LOWEND_A_v4.pth', 'engine': 'vr'},
    'vr_mgm_lowend_b': {'backend': 'audio_separator', 'filename': 'MGM_LOWEND_B_v4.pth', 'engine': 'vr'},
    'vr_deecho_normal': {'backend': 'audio_separator', 'filename': 'UVR-De-Echo-Normal.pth', 'engine': 'vr'},
    'vr_deecho_aggressive': {'backend': 'audio_separator', 'filename': 'UVR-De-Echo-Aggressive.pth', 'engine': 'vr'},
    'vr_dereverb': {'backend': 'audio_separator', 'filename': 'UVR-DeEcho-DeReverb.pth', 'engine': 'vr'},
    'vr_denoise': {'backend': 'audio_separator', 'filename': 'UVR-DeNoise.pth', 'engine': 'vr'},
    'vr_denoise_lite': {'backend': 'audio_separator', 'filename': 'UVR-DeNoise-Lite.pth', 'engine': 'vr'},
    'vr_bve_4b': {'backend': 'audio_separator', 'filename': 'UVR-BVE-4B_SN-44100-1.pth', 'engine': 'vr'},

    # ── Drumsep ─────────────────────────────────────────────
    'drumsep_49469': {'backend': 'drumsep'},
    'drumsep_mdx23c_6': {
        'backend': 'audio_separator',
        'filename': 'MDX23C-DrumSep-aufr33-jarredou.ckpt',
        'engine': 'drumsep_mdx',
        'stems': ['kick', 'snare', 'toms', 'hh', 'ride', 'crash'],
        'aliases': ['aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt'],
    },
    'drumsep_mdx23c_5': {
        'backend': 'audio_separator',
        # jarredou 5-stem release is offline; 6-stem MDX23C weights are merged to cymbals.
        'filename': 'MDX23C-DrumSep-aufr33-jarredou.ckpt',
        'engine': 'drumsep_mdx',
        'stems': ['kick', 'snare', 'toms', 'hh', 'cymbals'],
        'merge_6stem': {'ride': 'cymbals', 'crash': 'cymbals'},
        'aliases': ['drumsep_5stems_mdx23c_jarredou.ckpt'],
    },

    # ── Instrument extractors (audio-separator + HF bundles) ──
    'inst_bs_roformer_sw': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'mode': 'multistem',
        'stems': ['vocals', 'bass', 'drums', 'guitar', 'piano', 'other'],
    },
    'inst_guitar': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_guitar_becruily': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_guitar_sw': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'mode': 'extract',
    },
    'inst_piano': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'piano',
        'mode': 'extract',
    },
    'inst_piano_sw': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'piano',
        'mode': 'extract',
    },
    'inst_piano_demucs': {
        'backend': 'audio_separator',
        'filename': 'htdemucs_6s.yaml',
        'engine': 'instrument',
        'target': 'piano',
        'mode': 'extract',
    },
    'inst_guitar_demucs': {
        'backend': 'audio_separator',
        'filename': 'htdemucs_6s.yaml',
        'engine': 'instrument',
        'target': 'guitar',
        'mode': 'extract',
    },
    'inst_bass_sw': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'bass',
        'mode': 'extract',
    },
    'inst_drums_sw': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'drums',
        'mode': 'extract',
    },
    'inst_woodwinds': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'woodwinds',
        'arch': 'vr',
    },
    'inst_choir_mf': {
        'backend': 'audio_separator',
        'filename': 'model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt',
        'engine': 'instrument',
        'mode': 'multistem',
        'stems': ['male', 'female'],
    },
    'inst_choir_aufr33': {
        'backend': 'audio_separator',
        'filename': 'bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt',
        'engine': 'instrument',
        'mode': 'multistem',
        'stems': ['male', 'female'],
    },
    'inst_lead_guitar': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
        'note': 'Lead/rhythm split — run becruily guitar on isolated guitar stem',
    },
    'inst_rhythm_guitar': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
        'note': 'Lead/rhythm split — run becruily guitar on isolated guitar stem',
    },
    'inst_electric_guitar': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_acoustic_guitar': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_keys': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'piano',
        'mode': 'extract',
        'note': 'Keys/piano stem from BS-Roformer SW',
    },
    'inst_strings': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'strings',
        'arch': 'vr',
        'note': 'VR woodwind proxy — run MVSep strings model via Reprocess when available',
    },
    'inst_violin': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'other',
        'mode': 'extract',
        'note': 'No public violin ckpt — use other stem; refine with MVSEP violin via cloud',
    },
    'inst_cello': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'other',
        'mode': 'extract',
    },
    'inst_viola': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'other',
        'mode': 'extract',
    },
    'inst_saxophone': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'woodwinds',
        'arch': 'vr',
        'note': 'VR wind proxy — MVSEP sax BS-Roformer (SDR 9.77) via cloud',
    },
    'inst_trumpet': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'woodwinds',
        'arch': 'vr',
    },
    'inst_brass': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'woodwinds',
        'arch': 'vr',
    },
    'inst_flute': {
        'backend': 'audio_separator',
        'filename': '17_HP-Wind_Inst-UVR.pth',
        'engine': 'instrument',
        'target': 'woodwinds',
        'arch': 'vr',
    },
    'inst_organ': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'piano',
        'mode': 'extract',
        'note': 'Organ proxy via piano stem — MVSEP organ BS-Roformer via cloud',
    },
    'inst_synth': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'other',
        'mode': 'extract',
    },
    'inst_percussion': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'drums',
        'mode': 'extract',
    },
    'inst_harp': {
        'backend': 'audio_separator',
        'filename': 'BS-Roformer-SW.ckpt',
        'engine': 'instrument',
        'target': 'other',
        'mode': 'extract',
    },
    'inst_choir': {
        'backend': 'audio_separator',
        'filename': 'model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt',
        'engine': 'instrument',
        'mode': 'multistem',
        'stems': ['male', 'female'],
    },
    'inst_banjo': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_mandolin': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },
    'inst_ukulele': {
        'backend': 'audio_separator',
        'filename': 'melband_roformer_guitar_becruily.ckpt',
        'engine': 'instrument',
        'target': 'guitar',
        'hf_bundle': 'melband_roformer_guitar_becruily',
    },

    # ── Post-FX / tools ─────────────────────────────────────
    'postfx_apollo_vocal': {'backend': 'postfx', 'fx': 'apollo', 'target_stem': 'vocals'},
    'postfx_apollo_universal': {'backend': 'postfx', 'fx': 'apollo', 'target_stem': 'all'},
    'postfx_matchering': {'backend': 'postfx', 'fx': 'matchering', 'target_stem': 'all', 'needs_reference': True},
    'postfx_transkun_piano': {'backend': 'postfx', 'fx': 'transkun', 'target_stem': 'piano'},

    # ── Baseline ────────────────────────────────────────────
    'spleeter_2': {'backend': 'spleeter'},
}

ENSEMBLE_PRESETS = {
    'vocal_balanced', 'vocal_clean', 'vocal_full', 'vocal_rvc',
    'karaoke', 'instrumental_clean', 'instrumental_full',
    'instrumental_balanced', 'instrumental_low_resource',
}

# ZFTurbo / jarredou MSST weights not yet in audio-separator's built-in catalog.
# Prefetched into the audio-separator cache (ckpt + yaml) on first use.
MSST_MODEL_BUNDLES: Dict[str, Dict[str, Any]] = {
    'model_vocals_htdemucs_sdr_8.78.ckpt': {
        'model_type': 'MDXC',
        'msst_model_type': 'htdemucs',
        'yaml': 'config_vocals_htdemucs.yaml',
        'files': {
            'model_vocals_htdemucs_sdr_8.78.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.0/'
                'model_vocals_htdemucs_sdr_8.78.ckpt'
            ),
            'config_vocals_htdemucs.yaml': (
                'https://raw.githubusercontent.com/ZFTurbo/Music-Source-Separation-Training/main/'
                'configs/config_vocals_htdemucs.yaml'
            ),
        },
    },
    'model_mdx23c_ep_168_sdr_7.0207.ckpt': {
        'model_type': 'MDXC',
        'yaml': 'config_musdb18_mdx23c.yaml',
        'files': {
            'model_mdx23c_ep_168_sdr_7.0207.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.1/'
                'model_mdx23c_ep_168_sdr_7.0207.ckpt'
            ),
            'config_musdb18_mdx23c.yaml': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.1/'
                'config_musdb18_mdx23c.yaml'
            ),
        },
    },
    'model_bs_polarformer_float16.ckpt': {
        'model_type': 'MDXC',
        'msst_model_type': 'bs_roformer',
        'yaml': 'model_bs_polarformer_float16.yaml',
        'files': {
            'model_bs_polarformer_float16.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.20/'
                'model_bs_polarformer_float16.ckpt'
            ),
            'model_bs_polarformer_float16.yaml': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.20/'
                'model_bs_polarformer_float16.yaml'
            ),
        },
    },
    'model_scnet_sdr_9.3244.ckpt': {
        'model_type': 'MDXC',
        'msst_model_type': 'scnet',
        'yaml': 'config_musdb18_scnet_large.yaml',
        'files': {
            'model_scnet_sdr_9.3244.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.8/'
                'model_scnet_sdr_9.3244.ckpt'
            ),
            'config_musdb18_scnet_large.yaml': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.8/'
                'config_musdb18_scnet_large.yaml'
            ),
        },
    },
    'model_scnet_ep_54_sdr_9.8051.ckpt': {
        'model_type': 'MDXC',
        'msst_model_type': 'scnet',
        'yaml': 'config_musdb18_scnet_xl.yaml',
        'files': {
            'model_scnet_ep_54_sdr_9.8051.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.13/'
                'model_scnet_ep_54_sdr_9.8051.ckpt'
            ),
            'config_musdb18_scnet_xl.yaml': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.13/'
                'config_musdb18_scnet_xl.yaml'
            ),
        },
    },
    'model_scnet_ep_36_sdr_10.0891.ckpt': {
        'model_type': 'MDXC',
        'msst_model_type': 'scnet',
        'yaml': 'config_musdb18_scnet_xl_more_wide_v5.yaml',
        'files': {
            'model_scnet_ep_36_sdr_10.0891.ckpt': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.15/'
                'model_scnet_ep_36_sdr_10.0891.ckpt'
            ),
            'config_musdb18_scnet_xl_more_wide_v5.yaml': (
                'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.15/'
                'config_musdb18_scnet_xl_more_wide_v5.yaml'
            ),
        },
    },
}

# HuggingFace bundles for instrument ckpt+yaml pairs not yet in audio-separator cache.
INSTRUMENT_HF_BUNDLES: Dict[str, Dict[str, Any]] = {
    'melband_roformer_guitar_becruily': {
        'repo_id': 'becruily/mel-band-roformer-guitar',
        'files': {
            'melband_roformer_guitar_becruily.ckpt': 'becruily_guitar.ckpt',
            'config_melband_roformer_guitar_becruily.yaml': 'config_guitar_becruily.yaml',
        },
    },
    'BS-Roformer-SW': {
        'repo_id': 'jarredou/BS-Roformer-SW',
        'files': {
            'BS-Roformer-SW.ckpt': 'BS-Roformer-SW.ckpt',
            'BS-Roformer-SW.yaml': 'BS-Roformer-SW.yaml',
        },
        'optional': True,
    },
}


# Legacy catalog filenames → audio-separator supported names
AUDIO_SEPARATOR_FILENAME_ALIASES = {
    'mel_band_roformer_kim_ft_erika.ckpt': 'vocals_mel_band_roformer.ckpt',
}


def resolve_audio_separator_filename(filename: str) -> str:
    return AUDIO_SEPARATOR_FILENAME_ALIASES.get(filename, filename)


def resolve_model_variant(variant_id: str) -> Dict[str, Any]:
    return MODEL_VARIANTS.get(variant_id, {})