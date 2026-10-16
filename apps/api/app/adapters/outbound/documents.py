"""Preparación de imágenes/PDF y lectura del QR fiscal. Es trabajo de CPU: quien lo llama lo corre en
hilos para no bloquear el event loop."""

from __future__ import annotations

import io
import logging
import time

import numpy as np
import zxingcpp
from PIL import Image, ImageOps
from pypdf import PdfReader

from app.domain.ports import ImageOptions, PreparedDocument

logger = logging.getLogger(__name__)

# Protección contra bombas de descompresión: se rechazan cantidades absurdas de píxeles antes de decodificar.
Image.MAX_IMAGE_PIXELS = 60_000_000

_QR_TIME_BUDGET_SECONDS = 0.3


class PillowDocumentPreparer:
    def prepare(self, content: bytes, mime_type: str, options: ImageOptions) -> PreparedDocument:
        if mime_type == "application/pdf":
            return self._prepare_pdf(content)
        started = time.perf_counter()
        image: Image.Image = Image.open(io.BytesIO(content))
        image = ImageOps.exif_transpose(image)  # los celulares guardan la rotación en el EXIF
        image = image.convert("RGB")
        gray = image.convert("L")
        blur = _blur_score(gray)
        llm = _encode_jpeg(_fit(image, options.max_side_px))
        hires = _encode_jpeg(_fit(image, options.hires_max_side_px), quality=90)
        variants = _qr_variants(gray)
        return PreparedDocument(
            mime_type=mime_type,
            llm_content=llm,
            llm_mime_type="image/jpeg",
            hires_content=hires,
            qr_variants=tuple(variants),
            blur_score=blur,
            is_blurry=blur < options.blur_threshold,
            thumbnail=_encode_jpeg(_fit(image, options.thumbnail_side_px), quality=75),
            timings={"prepare_ms": int((time.perf_counter() - started) * 1000)},
        )

    @staticmethod
    def _prepare_pdf(content: bytes) -> PreparedDocument:
        started = time.perf_counter()
        text = None
        try:
            reader = PdfReader(io.BytesIO(content))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:5]).strip() or None
        except Exception:  # noqa: BLE001 - una capa de texto dañada solo significa "sin texto"
            logger.info("PDF without a readable text layer")
        return PreparedDocument(
            mime_type="application/pdf",
            llm_content=content,  # la IA lee el PDF de forma nativa
            llm_mime_type="application/pdf",
            hires_content=content,
            pdf_text=text,
            timings={"prepare_ms": int((time.perf_counter() - started) * 1000)},
        )


class ZxingQrDecoder:
    def decode(self, document: PreparedDocument) -> list[str]:
        deadline = time.perf_counter() + _QR_TIME_BUDGET_SECONDS
        for variant in document.qr_variants:
            try:
                found = zxingcpp.read_barcodes(variant, formats=zxingcpp.BarcodeFormats(zxingcpp.BarcodeFormat.QRCode))
            except Exception:  # noqa: BLE001
                found = []
            texts = [r.text for r in found if r.text]
            if texts:
                return texts
            if time.perf_counter() > deadline:
                break
        return []


def _fit(image: Image.Image, max_side: int) -> Image.Image:
    if max(image.size) <= max_side:
        return image
    copy = image.copy()
    copy.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return copy


def _encode_jpeg(image: Image.Image, quality: int = 85) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def _blur_score(gray: Image.Image) -> float:
    """Varianza del laplaciano sobre un tamaño normalizado: valores bajos indican una foto borrosa."""
    small = np.asarray(_fit(gray, 1024), dtype=np.float32)
    if small.shape[0] < 3 or small.shape[1] < 3:
        return 0.0
    lap = small[:-2, 1:-1] + small[2:, 1:-1] + small[1:-1, :-2] + small[1:-1, 2:] - 4 * small[1:-1, 1:-1]
    return float(lap.var())


def _qr_variants(gray: Image.Image) -> list[Image.Image]:
    """Las fotos de papel térmico suelen necesitar ayuda: original, con más contraste y ampliada."""
    base = _fit(gray, 2000)
    variants = [base, ImageOps.autocontrast(base, cutoff=2)]
    if max(base.size) < 1400:
        variants.append(base.resize((base.width * 2, base.height * 2), Image.Resampling.LANCZOS))
    return variants
