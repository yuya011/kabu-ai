import os
import json
import pandas as pd
import numpy as np
import jquantsapi
from dotenv import load_dotenv

load_dotenv()

def audit_jquants():
    print("=" * 75)
    print("🔍 J-Quants API V2 実地検証 & Point-in-time 監査")
    print("=" * 75)
    
    api_key = os.getenv("J_Quants_API", "")
    cli = jquantsapi.ClientV2(api_key=api_key)
    
    # 1. 銘柄マスタ確認 (/eq/master)
    print("\n[Audit 1] 銘柄マスタ (/eq/master) 取得...")
    df_master = cli.get_eq_master()
    print(f"✅ 銘柄マスタ取得成功: {len(df_master):,} 銘柄")
    print(df_master[["Code", "CoName", "S17Nm", "S33Nm", "MktNm", "ScaleCat"]].head(3))
    
    # 2. 財務サマリ (/fins/summary) の構造・Point-in-time確認 (20241114: 決算集中日)
    target_date = "20241114"
    print(f"\n[Audit 2] 決算集中日 ({target_date}) の財務サマリ (/fins/summary) 取得...")
    df_fin = cli.get_fin_summary(date_yyyymmdd=target_date)
    print(f"✅ 取得成功: {len(df_fin):,} 件の開示レコード")
    print("財務サマリ カラム一覧:", list(df_fin.columns))
    
    # (a) 開示時刻の欠損率
    time_col = "DiscTime" if "DiscTime" in df_fin.columns else ("DisclosedTime" if "DisclosedTime" in df_fin.columns else None)
    if time_col:
        null_cnt = df_fin[time_col].isna().sum() + (df_fin[time_col] == "").sum()
        print(f"  ・{time_col} 欠損: {null_cnt} / {len(df_fin)} ({null_cnt/len(df_fin)*100:.1f}%)")
        print(f"  ・{time_col} サンプル:", df_fin[time_col].dropna().head(5).tolist())
        # 15:00以降
        after_15 = (df_fin[time_col].dropna() >= "15:00:00").sum()
        print(f"  ・15:00以降（引け後）開示比率: {after_15 / len(df_fin) * 100:.1f}%")
    
    # (b) 予想・業績関連カラムとサンプル
    print("\n財務開示サンプル (上位1件の主要項目辞書):")
    sample_dict = df_fin.iloc[0].dropna().to_dict()
    for k, v in sample_dict.items():
        print(f"  - {k}: {v}")

    # (c) 同一銘柄・同一四半期の重複（訂正開示）の有無
    if "Code" in df_fin.columns and "CurPeriodEnd" in df_fin.columns:
        dups = df_fin[df_fin.duplicated(subset=["Code", "CurPeriodEnd"], keep=False)]
        print(f"\n  ・同日内での重複開示（訂正等）レコード数: {len(dups)} 件")

    # 3. 日足株価 (/eq/bars/daily) 取得確認 (トヨタ 72030)
    print(f"\n[Audit 3] 日足株価 (/eq/bars/daily) 取得確認 (トヨタ 72030)...")
    df_bars = cli.get_eq_bars_daily(code="72030", date_yyyymmdd=target_date)
    print(f"✅ 株価取得成功:")
    print(df_bars)

    print("\n" + "=" * 75)
    print("🏁 実地監査完了: J-Quants V2 API による Point-in-time データの取得可能性を確認")
    print("=" * 75)

if __name__ == "__main__":
    audit_jquants()
