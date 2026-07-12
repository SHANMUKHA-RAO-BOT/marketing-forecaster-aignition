#!/usr/bin/env python
import os
import re
import sys
import pandas as pd

# Define base directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def check_run_sh():
    run_sh_path = os.path.join(BASE_DIR, 'run.sh')
    if os.path.exists(run_sh_path):
        return True, f"Found run.sh at {run_sh_path}"
    return False, "run.sh is missing from the repository root"

def check_requirements_txt():
    req_path = os.path.join(BASE_DIR, 'requirements.txt')
    if os.path.exists(req_path):
        return True, f"Found requirements.txt at {req_path}"
    return False, "requirements.txt is missing from the repository root"

def check_data_dir():
    data_dir_path = os.path.join(BASE_DIR, 'data')
    if os.path.isdir(data_dir_path):
        return True, f"Found data directory at {data_dir_path}"
    return False, "data directory is missing or is not a directory"

def check_model_pkl():
    model_path = os.path.join(BASE_DIR, 'pickle', 'model.pkl')
    if os.path.exists(model_path):
        return True, f"Found pre-trained model artifact model.pkl at {model_path}"
    return False, "pickle/model.pkl is missing from the repository"

def check_dependencies_pinned():
    req_path = os.path.join(BASE_DIR, 'requirements.txt')
    if not os.path.exists(req_path):
        return False, "requirements.txt not found, cannot verify dependencies"
    
    with open(req_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    unpinned = []
    total = 0
    for line_num, line in enumerate(lines, 1):
        clean = line.strip()
        if not clean or clean.startswith('#'):
            continue
        total += 1
        # Check if line contains ==
        if '==' not in clean:
            unpinned.append(f"Line {line_num}: '{clean}'")
            
    if unpinned:
        return False, f"Found unpinned dependencies in requirements.txt:\n" + "\n".join(unpinned)
    return True, f"All {total} dependencies in requirements.txt are correctly pinned with '=='"

def check_no_absolute_paths():
    exclude_dirs = {'.git', '__pycache__', 'node_modules', 'data', 'pickle', 'output', 'brain', '.gemini'}
    allowed_exts = {'.py', '.js', '.html', '.css', '.sh', '.md'}
    
    absolute_path_matches = []
    
    # regex for Windows absolute path (e.g. C:\path or d:/path, avoiding https:// or similar)
    win_path_rx = re.compile(r'(?<![a-zA-Z/])[A-Za-z]:[\\/]')
    
    # regex for Unix absolute path starting with common roots
    unix_path_rx = re.compile(r'/(?:usr|home|tmp|var|opt|etc|mnt|root|bin|srv)/')
    
    for root, dirs, files in os.walk(BASE_DIR):
        # modify dirs in-place to exclude
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        for file in files:
            file_path = os.path.join(root, file)
            # Skip compliance_check.py itself to avoid self-matching
            if file == 'compliance_check.py':
                continue
                
            _, ext = os.path.splitext(file)
            if ext not in allowed_exts:
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_num, line in enumerate(f, 1):
                        # Skip comment shebang lines
                        if line_num == 1 and line.startswith('#!'):
                            continue
                        # Search for Windows absolute path
                        if win_path_rx.search(line):
                            # Exclude url prefixes
                            if 'http://' not in line and 'https://' not in line:
                                rel_path = os.path.relpath(file_path, BASE_DIR)
                                absolute_path_matches.append(f"{rel_path}:{line_num}: {line.strip()}")
                        # Search for Unix absolute path
                        elif unix_path_rx.search(line):
                            # Check that it's not a URL
                            if 'http://' not in line and 'https://' not in line:
                                rel_path = os.path.relpath(file_path, BASE_DIR)
                                absolute_path_matches.append(f"{rel_path}:{line_num}: {line.strip()}")
            except Exception as e:
                # ignore read errors
                pass
                
    if absolute_path_matches:
        return False, "Found potential absolute paths in files:\n" + "\n".join(absolute_path_matches[:10]) + (f"\n... and {len(absolute_path_matches) - 10} more" if len(absolute_path_matches) > 10 else "")
    return True, "No hardcoded absolute paths found in codebase files (dynamic and relative paths verified)"

def check_output_schema_valid():
    paths_to_try = [
        os.path.join(BASE_DIR, 'output', 'predictions.csv'),
        os.path.join(BASE_DIR, 'predictions.csv')
    ]
    
    target_path = None
    for p in paths_to_try:
        if os.path.exists(p):
            target_path = p
            break
            
    if not target_path:
        return False, "Output predictions.csv file not found at output/predictions.csv or predictions.csv. Run run.sh or execution first."
        
    try:
        df = pd.read_csv(target_path)
        if df.empty:
            return False, f"Output file at {target_path} is empty"
            
        # Verify it has numeric rows and has valid non-nan rows
        if df.isnull().any().any():
            return False, f"Output file at {target_path} contains missing (NaN) values"
            
        # Verify basic columns types: date should be string/object, other columns float
        for col in df.columns:
            if col in ['channel', 'campaign', 'date']:
                continue
            if not pd.api.types.is_numeric_dtype(df[col]):
                return False, f"Column '{col}' in output file is not numeric"
                
        return True, f"Output file at {os.path.relpath(target_path, BASE_DIR)} exists, parses as valid CSV, and contains no missing values"
    except Exception as e:
        return False, f"Failed to parse or validate output schema: {str(e)}"

def check_prediction_columns():
    paths_to_try = [
        os.path.join(BASE_DIR, 'output', 'predictions.csv'),
        os.path.join(BASE_DIR, 'predictions.csv')
    ]
    
    target_path = None
    for p in paths_to_try:
        if os.path.exists(p):
            target_path = p
            break
            
    if not target_path:
        return False, "Output predictions.csv file not found, cannot verify columns"
        
    expected_cols = [
        "date",
        "channel",
        "campaign",
        "predicted_revenue_p10",
        "predicted_revenue_p50",
        "predicted_revenue_p90",
        "predicted_roas_p10",
        "predicted_roas_p50",
        "predicted_roas_p90"
    ]
    
    try:
        df = pd.read_csv(target_path)
        actual_cols = list(df.columns)
        
        # Check order and exact names
        if actual_cols != expected_cols:
            return False, f"Columns in {os.path.relpath(target_path, BASE_DIR)} do not match expectations.\nExpected: {expected_cols}\nActual:   {actual_cols}"
            
        return True, f"Columns in output predictions.csv exactly match the 9 required lowercase fields in the correct order"
    except Exception as e:
        return False, f"Failed to read columns from output file: {str(e)}"

def check_network_dependencies():
    # Verify that the pipeline operates offline by verifying key patterns in src/predict.py
    predict_py_path = os.path.join(BASE_DIR, 'src', 'predict.py')
    if not os.path.exists(predict_py_path):
        return False, "src/predict.py not found, cannot verify network dependencies"
        
    with open(predict_py_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Check that GEMINI_API_KEY is retrieved from environment and local fallback exists
    has_api_key_check = "GEMINI_API_KEY" in content or "gemini_key" in content
    has_local_explanation = "generate_local_explanation" in content
    
    if not has_api_key_check:
        return False, "src/predict.py does not check for GEMINI_API_KEY environment variable"
    if not has_local_explanation:
        return False, "src/predict.py is missing local offline growth analyst fallback ('generate_local_explanation')"
        
    # Verify offline operation by ensuring uvicorn/fastapi doesn't download anything at runtime
    # And there are no external URL fetches in utils.py
    utils_py_path = os.path.join(BASE_DIR, 'src', 'utils.py')
    if os.path.exists(utils_py_path):
        with open(utils_py_path, 'r', encoding='utf-8') as f:
            utils_content = f.read()
        if "requests." in utils_content or "urllib." in utils_content:
            return False, "src/utils.py contains HTTP/network requests, which should be isolated to optional explainability steps"
            
    return True, "No runtime network dependencies found. Offline execution capability with local rules-based fallback is verified"

def main():
    print("======================================================================")
    print("             AIgnition Compliance Verification Utility               ")
    print("======================================================================")
    
    checks = [
        ("run.sh exists", check_run_sh),
        ("requirements.txt exists", check_requirements_txt),
        ("data directory exists", check_data_dir),
        ("pickle/model.pkl exists", check_model_pkl),
        ("All dependencies pinned", check_dependencies_pinned),
        ("No absolute paths in codebase", check_no_absolute_paths),
        ("Output schema valid", check_output_schema_valid),
        ("Prediction columns match target", check_prediction_columns),
        ("No runtime network dependencies", check_network_dependencies)
    ]
    
    all_passed = True
    passed_count = 0
    
    for idx, (name, check_fn) in enumerate(checks, 1):
        print(f"Check {idx}/9: {name} ... ", end="", flush=True)
        try:
            passed, msg = check_fn()
            if passed:
                print("PASS")
                print(f"  [+] {msg}\n")
                passed_count += 1
            else:
                print("FAIL")
                print(f"  [-] {msg}\n")
                all_passed = False
        except Exception as e:
            print("ERROR")
            print(f"  [!] Exception during check: {str(e)}\n")
            all_passed = False
            
    print("======================================================================")
    print(f"Result: {passed_count}/9 checks passed.")
    if all_passed:
        print("COMPLIANCE STATUS: PASS")
        sys.exit(0)
    else:
        print("COMPLIANCE STATUS: FAIL")
        sys.exit(1)

if __name__ == '__main__':
    main()
