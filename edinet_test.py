import urllib.request
import urllib.error
import json
import datetime

# EDINET API v2 公開書類一覧取得テスト (完全無料)
# エンドポイント: https://api.edinet-fsa.go.jp/api/v2/documents.json
EDINET_API_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"

def test_edinet_list(date_str: str = None):
    if date_str is None:
        # 直近の平日（例: 2024年秋〜）
        date_str = "2024-11-14"  # 典型的な秋の決算・四半期報告書集中日
        
    url = f"{EDINET_API_URL}?date={date_str}&type=2"
    print(f"📡 EDINET API疎通テスト (日付: {date_str})...", flush=True)
    
    req = urllib.request.Request(url, headers={"User-Agent": "KabuAI-Research/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode("utf-8"))
            results = data.get("results", [])
            print(f"✅ 取得成功: 総書類件数 {len(results)} 件", flush=True)
            
            # 四半期報告書 / 有価証券報告書 / 臨時報告書の抽出
            target_docs = [d for d in results if d.get("docTypeCode") in ["140", "120", "160"]]
            print(f"  ・決算・有報・四半期報告書件数: {len(target_docs)} 件", flush=True)
            
            for doc in target_docs[:5]:
                print(f"    - [{doc.get('submitDateTime')}] {doc.get('filerName')} ({doc.get('secCode', 'N/A')}): {doc.get('docDescription')}")
                
            return True
    except Exception as e:
        print(f"⚠️ EDINET API 接続エラー (APIキーが必要な場合があります): {e}", flush=True)
        return False

if __name__ == "__main__":
    test_edinet_list()
