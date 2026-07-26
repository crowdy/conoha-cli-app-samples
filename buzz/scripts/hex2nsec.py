#!/usr/bin/env python3
# hex(64) Nostr 秘密鍵 → nsec(bech32, NIP-19)。引数が無ければ stdin から読む。
import sys
CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
def polymod(values):
    GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3]; chk=1
    for v in values:
        b=chk>>25; chk=((chk&0x1ffffff)<<5)^v
        for i in range(5): chk^=GEN[i] if ((b>>i)&1) else 0
    return chk
def hrp_expand(h): return [ord(x)>>5 for x in h]+[0]+[ord(x)&31 for x in h]
def checksum(h,d):
    pm=polymod(hrp_expand(h)+d+[0,0,0,0,0,0])^1
    return [(pm>>5*(5-i))&31 for i in range(6)]
def encode(h,d): return h+'1'+''.join(CHARSET[c] for c in d+checksum(h,d))
def convertbits(data):
    acc=0;bits=0;ret=[]
    for value in data:
        acc=(acc<<8)|value;bits+=8
        while bits>=5:
            bits-=5;ret.append((acc>>bits)&31)
    if bits: ret.append((acc<<(5-bits))&31)
    return ret
hexkey=(sys.argv[1] if len(sys.argv)>1 else sys.stdin.read()).strip()
if len(hexkey)!=64 or any(c not in "0123456789abcdefABCDEF" for c in hexkey):
    sys.exit("usage: hex2nsec.py <64-hex-secret>   (Nostr hex private key -> nsec1...)")
print(encode("nsec", convertbits(bytes.fromhex(hexkey))))
