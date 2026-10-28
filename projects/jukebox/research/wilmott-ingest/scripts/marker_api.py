"""Print marker's installed version and the config options of the converter/processors (API check)."""
import importlib.metadata as md
import os
import marker

print("marker-pdf", md.version("marker-pdf"), "surya-ocr", md.version("surya-ocr"))
p = os.path.dirname(marker.__file__)
print(sorted(os.listdir(p)))
print(sorted(os.listdir(os.path.join(p, "converters"))))
print(sorted(os.listdir(os.path.join(p, "processors"))))
from marker.config.parser import ConfigParser  # noqa: E402
import inspect  # noqa: E402
print(inspect.signature(ConfigParser.__init__))
