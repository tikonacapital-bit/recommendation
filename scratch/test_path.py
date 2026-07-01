import os

paths = [
    "/C:/Users/YADAV KISHAN KUMAR/.gemini/antigravity-ide/brain/c14938d8-6311-44f6-8cc5-3be6481278ea/screener_filters_expanded_1782732868007.png",
    "/Users/YADAV KISHAN KUMAR/.gemini/antigravity-ide/brain/c14938d8-6311-44f6-8cc5-3be6481278ea/screener_filters_expanded_1782732868007.png",
    "C:/Users/YADAV KISHAN KUMAR/.gemini/antigravity-ide/brain/c14938d8-6311-44f6-8cc5-3be6481278ea/screener_filters_expanded_1782732868007.png"
]

for p in paths:
    print(f"Path: {p}")
    print(f"  abspath: {os.path.abspath(p)}")
    print(f"  normpath: {os.path.normpath(p)}")
