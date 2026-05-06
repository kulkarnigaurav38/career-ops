"""Convert tailored DOCX to PDF via docx2pdf with single retry on failure.

Word COM is single-instance machine-wide, so other parallel workers can cause
transient failures. Retry once after 30s sleep.
"""
import os
import sys
import time
import shutil
from docx2pdf import convert

ROOT = r"C:\Users\kulka\Downloads\career-ops-babyyy"
OUT = os.path.join(ROOT, "output")

# REF -> (CV pdf name, CL pdf name). All EN here.
JOBS = {
    "0UY1": ("Gaurav_Kulkarni_CV_0UY1.pdf", "Gaurav_Kulkarni_CoverLetter_0UY1.pdf"),
    "PYEN": ("Gaurav_Kulkarni_CV_PYEN.pdf", "Gaurav_Kulkarni_CoverLetter_PYEN.pdf"),
    "WF4I": ("Gaurav_Kulkarni_CV_WF4I.pdf", "Gaurav_Kulkarni_CoverLetter_WF4I.pdf"),
    "H2M9": ("Gaurav_Kulkarni_CV_H2M9.pdf", "Gaurav_Kulkarni_CoverLetter_H2M9.pdf"),
    "RYRI": ("Gaurav_Kulkarni_CV_RYRI.pdf", "Gaurav_Kulkarni_CoverLetter_RYRI.pdf"),
    "MKWH": ("Gaurav_Kulkarni_CV_MKWH.pdf", "Gaurav_Kulkarni_CoverLetter_MKWH.pdf"),
    "JRST": ("Gaurav_Kulkarni_CV_JRST.pdf", "Gaurav_Kulkarni_CoverLetter_JRST.pdf"),
    "LA6K": ("Gaurav_Kulkarni_CV_LA6K.pdf", "Gaurav_Kulkarni_CoverLetter_LA6K.pdf"),
    "A99F": ("Gaurav_Kulkarni_CV_A99F.pdf", "Gaurav_Kulkarni_CoverLetter_A99F.pdf"),
}


def convert_one(docx_path, final_pdf_name):
    """Convert one DOCX to PDF, renaming result to final_pdf_name.
    Returns True on success.
    Retries once after 30s on failure.
    """
    # docx2pdf outputs with same basename but .pdf extension
    base = os.path.basename(docx_path).replace(".docx", ".pdf")
    raw_pdf = os.path.join(OUT, base)
    target_pdf = os.path.join(OUT, final_pdf_name)

    for attempt in range(2):
        try:
            convert(docx_path, raw_pdf)
            if os.path.exists(raw_pdf):
                if raw_pdf != target_pdf:
                    shutil.move(raw_pdf, target_pdf)
                print(f"  OK: {final_pdf_name}")
                return True
            else:
                raise RuntimeError("PDF not produced")
        except Exception as e:
            print(f"  Attempt {attempt+1} failed for {docx_path}: {e}", file=sys.stderr)
            if attempt == 0:
                print("  Sleeping 30s and retrying once...", file=sys.stderr)
                time.sleep(30)
            else:
                return False
    return False


def main():
    results = {}
    refs = sys.argv[1:] if len(sys.argv) > 1 else list(JOBS.keys())
    for ref in refs:
        cv_pdf, cl_pdf = JOBS[ref]
        cv_docx = os.path.join(OUT, f"{ref}-cv.docx")
        cl_docx = os.path.join(OUT, f"{ref}-coverletter.docx")
        print(f"[{ref}] converting...")
        cv_ok = convert_one(cv_docx, cv_pdf)
        cl_ok = convert_one(cl_docx, cl_pdf)
        results[ref] = (cv_ok, cl_ok)

    print("\nSUMMARY:")
    for ref, (cv_ok, cl_ok) in results.items():
        print(f"  {ref}: CV={'OK' if cv_ok else 'FAIL'} CL={'OK' if cl_ok else 'FAIL'}")


if __name__ == "__main__":
    main()
