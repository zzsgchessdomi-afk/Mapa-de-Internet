# CrewAI 1.15.22 resolves translation resources relative to package __file__.
# Collect CrewAI as source files outside PYZ so __file__ points at the real
# on-disk package directory beside translations/en.json. This is intentionally
# scoped to CrewAI; the rest of the bundle remains archived.
module_collection_mode = "py"
