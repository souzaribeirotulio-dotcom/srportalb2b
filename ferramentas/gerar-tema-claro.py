"""Gera a parte automática de src/tema-claro.css a partir do CSS do portal (index.html + src/*.css).

O tema claro (identidade da LP conteudo.souzaribeiro.net) troca as variáveis de cor em :root e mantém
"ilhas escuras" (topo, faixa do "bom dia", rodapé, clips, etiquetas sobre a foto) com as variáveis
escuras. Este script acha as regras que têm cor escura escrita direto (sem variável) e gera a versão
clara delas, fora das ilhas. Rodar de novo sempre que o CSS do portal mudar:
    python3 ferramentas/gerar-tema-claro.py
"""
import re, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ALVO = RAIZ / 'src' / 'tema-claro.css'
MARCA = '/* ===== gerado por ferramentas/gerar-tema-claro.py: não edite abaixo desta linha ===== */'

# Regras dentro destas "ilhas" continuam escuras (as variáveis escuras são repostas nelas).
ILHAS = ('header', '.hero', 'footer', '.clip', '.cfoto', '.ccard', '.cbtn', '.ctop', '.cside', '.cpause', '.cttl', '.cbar',
         '.toast', '.cat', '.eye', '.fxtag', '.logo', '.lhead .s', '.bnr', '.tabbar', '#souzinha', '.sz-', '.cfn', '.cgrad')

def css_do_portal():
    html = (RAIZ / 'index.html').read_text()
    blocos = re.findall(r'<style>(.*?)</style>', html, re.S)
    for f in ('app.css', 'portal.css', 'entrada.css'):
        blocos.append((RAIZ / 'src' / f).read_text())
    return '\n'.join(blocos)

def regras(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    # regras simples (inclusive as de dentro de @media: o seletor vale igual no claro)
    for m in re.finditer(r'([^{}@]+)\{([^{}]*)\}', css):
        sel, corpo = m.group(1).strip(), m.group(2)
        if not sel or sel.startswith(('from', 'to', '0%', '100%')) or re.match(r'^\d', sel): continue
        yield sel, corpo

ESCUROS = {'#123009': '#ffffff', '#0a1f07': '#ffffff', '#0f2a09': '#ffffff', '#081b06': '#f7faf2', '#0b2008': '#ffffff',
           '#0c2408': '#ffffff', '#061505': '#f4f8ee', '#102d0a': '#f7faf2', '#15370d': '#eef4e6'}

def _lum(r, g, b):
    f = lambda c: (c / 255) / 12.92 if c <= 10 else (((c / 255) + .055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)

def clarear(valor):
    """Cores escuras (verdes do tema) viram claras; branco translúcido vira verde-escuro translúcido."""
    def hexa(m):
        h = m.group(1)
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        if (r, g, b) == (0, 0, 0): return m.group(0)
        return '#ffffff' if _lum(r, g, b) < .06 else m.group(0)
    v = re.sub(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', hexa, valor)
    def rgba(m):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3)); a = m.group(4)
        if (r, g, b) == (255, 255, 255): return f'rgba(11,34,7,{min(.05, round(float(a) * .6, 3))})'
        if (r, g, b) == (0, 0, 0): return f'rgba(11,34,7,{round(float(a) * .8, 3)})' if float(a) >= .4 else '#f4f8ee'
        if _lum(r, g, b) < .06: return f'rgba(255,255,255,{a})'
        return m.group(0)
    v = re.sub(r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)', rgba, v)
    return v

def escurecer_texto(valor):
    """Texto em tom pastel (feito para o fundo escuro) fica escuro o bastante para o fundo claro."""
    def hexa(m):
        h = m.group(1)
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        if min(r, g, b) > 235 or _lum(r, g, b) < .45: return m.group(0)
        return '#%02x%02x%02x' % tuple(int(c * .5) for c in (r, g, b))
    return re.sub(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', hexa, valor)

def na_ilha_corpo(sel):
    return all(na_ilha(x) for x in re.split(r',(?![^(]*\))', sel))

def sombra(valor):
    return re.sub(r'rgba\(\s*0,\s*0,\s*0\s*,\s*([\d.]+)\)', lambda m: f'rgba(11,34,7,{round(float(m.group(1)) * .28, 3)})', valor)

def na_ilha(s):
    s = s.strip()
    return s.startswith(ILHAS) or any(f' {i}' in f' {s}' and s.split()[0].startswith(ILHAS) for i in ILHAS)

def prefixar(seletores):
    out = []
    for s in seletores:
        s = s.strip()
        if not s or na_ilha(s): continue
        if s in (':root', 'html'): continue
        out.append(f'html.tema-claro {s}' if not s.startswith('body') else f'html.tema-claro {s}')
    return out

def gerar():
    linhas = []
    vistos = set()
    for sel, corpo in regras(css_do_portal()):
        seletores = [x for x in re.split(r',(?![^(]*\))', sel)]
        novos = []
        for d in corpo.split(';'):
            if ':' not in d: continue
            p, v = d.split(':', 1); p = p.strip().lower(); v = v.strip()
            if p in ('background', 'background-color', 'background-image'):
                c = clarear(v)
                if c != v: novos.append(f'{p}:{c}')
            elif p in ('box-shadow',):
                c = sombra(v)
                if c != v: novos.append(f'{p}:{c}')
            elif p in ('color', 'border-color', 'border', 'border-top', 'border-bottom', 'border-left', 'outline'):
                if p == 'color' and re.search(r'var\(--lima(\s*,[^)]*)?\)', v):
                    novos.append(f'{p}:{re.sub(r"var\(--lima(\s*,[^)]*)?\)", "var(--lima-tx)", v)}')
                c = clarear(v)
                if c != v and p != 'color': novos.append(f'{p}:{c}')
                if p == 'color' and not na_ilha_corpo(sel):
                    e = escurecer_texto(v)
                    if e != v: novos.append(f'{p}:{e}')
                if p == 'color' and re.fullmatch(r'#fff(fff)?|white', v.replace('!important', '').strip(), re.I):
                    pass  # texto branco quase sempre está sobre fundo de cor (botão, selo); fica como está
        if not novos: continue
        pref = prefixar(seletores)
        if not pref: continue
        chave = (tuple(pref), tuple(novos))
        if chave in vistos: continue
        vistos.add(chave)
        linhas.append(f'{",".join(pref)}{{{";".join(novos)}}}')
    return '\n'.join(linhas)

if __name__ == '__main__':
    atual = ALVO.read_text() if ALVO.exists() else MARCA + '\n'
    manual = atual.split(MARCA)[0]
    ALVO.write_text(manual + MARCA + '\n' + gerar() + '\n')
    print(ALVO, 'regras geradas:', gerar().count('\n') + 1)
