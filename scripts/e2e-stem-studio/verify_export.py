import glob, json, subprocess, re, zipfile, io, sys
import numpy as np, soundfile as sf, pyloudnorm as pyln
from mutagen.wave import WAVE
from mutagen.id3 import ID3
from mutagen.mp3 import MP3
def ff(path):
    r = subprocess.run(['ffmpeg','-nostats','-i',path,'-af','ebur128=peak=true','-f','null','-'],capture_output=True,text=True).stderr
    s = r[r.rfind('Summary:'):]
    g = lambda k: float(re.search(k+r':\s+(-?[\d.]+)', s).group(1))
    return g('I'), g('LRA'), float(re.search(r'Peak:\s+(-?[\d.inf-]+) dBFS', s).group(1))
def pl(x, sr): return pyln.Meter(sr).integrated_loudness(x)
print('--- LUFS: pyloudnorm vs ffmpeg ebur128')
for f in sorted(glob.glob('out/exp/*mix.wav')):
    x, sr = sf.read(f, dtype='float64'); I, LRA, TP = ff(f); p = pl(x, sr)
    print(f.split('__')[0].split('/')[-1].ljust(9), 'frames', len(x), 'sr', sr, f'pyln {p:.2f}  ffmpeg I {I:.2f} LRA {LRA:.2f} TP {TP:.2f}', 'dI=%.3f' % (p - I))
rep = {n: json.load(open(f'out/exp/{n}.json')) for n in ['mixnorm','eachnorm','club','pcm24','edits','f32']}
print('--- engine report vs measured')
for n in ['mixnorm','club','eachnorm']:
    for r in rep[n]['report']:
        if r['lufs'] is None: continue
        fn = glob.glob(f'out/exp/{n}__{r["file"]}')[0]; x, sr = sf.read(fn, dtype='float64'); I, LRA, TP = ff(fn)
        print(n, r['file'][-14:].ljust(14), f"engine {r['lufs']:.2f}/{r['tp']:.2f}  ffmpeg {I:.2f}/{TP:.2f}", 'note', r['note'])
print('--- mix == sum of stems (pcm24 vs f32)')
st = [sf.read(f, dtype='float64')[0] for f in sorted(glob.glob('out/exp/f32__*.wav')) if 'mix' not in f]
mx = sf.read(glob.glob('out/exp/f32__*mix.wav')[0], dtype='float64')[0]
print('max |mix - sum(stems)| =', np.abs(mx - sum(st)).max())
print('--- tags')
for f in sorted(glob.glob('out/exp/pcm24__*bass.wav'))+glob.glob('out/exp/f32__*mix.wav'):
    raw = open(f,'rb').read(); print(f.split('__')[1], 'INFO' , b'INFOINAM' in raw, 'iXML', b'iXML' in raw and b'MADE_WITH' in raw, 'id3', b'id3 ' in raw)
    w = WAVE(f); print('  mutagen id3 tags:', {k: str(v)[:70] for k, v in w.tags.items()} if w.tags else None)
    print('  ffprobe:', subprocess.run(['ffprobe','-v','error','-show_entries','format_tags','-of','default=nw=1',f],capture_output=True,text=True).stdout.replace('\n',' | '))
    i = raw.find(b'<BWFXML'); print('  iXML:', raw[i:i+260])
    print('  stream:', subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name,sample_rate,channels,bits_per_sample,duration','-of','csv=p=0',f],capture_output=True,text=True).stdout.strip())
mp = glob.glob('out/exp/mp3__*.mp3')[0]; m = MP3(mp); print('mp3', m.info.sample_rate, m.info.bitrate, round(m.info.length,2), {k: str(v)[:60] for k,v in ID3(mp).items()})
print('--- edits lengths')
for f in sorted(glob.glob('out/exp/edits__*.wav')):
    i = sf.info(f); print(f.split('__')[1].ljust(26), i.frames, 'expected', 9*44100, 'sec', i.duration)
print('--- zip')
z = zipfile.ZipFile(glob.glob('out/exp/zip__*.zip')[0]); print(z.testzip(), [(n.filename, n.file_size) for n in z.infolist()])
for n in z.namelist():
    i = sf.info(io.BytesIO(z.read(n))); print(n, i.frames, i.samplerate, i.subtype)
