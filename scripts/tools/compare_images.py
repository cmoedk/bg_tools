import sys
import os
import argparse
from pathlib import Path
from PIL import Image, ImageTk
import tkinter as tk

def get_image_pairs(folder1, folder2):
    files1 = {f.name for f in Path(folder1).iterdir() if f.is_file()}
    files2 = {f.name for f in Path(folder2).iterdir() if f.is_file()}
    common = sorted(files1 & files2)
    return [(os.path.join(folder1, name), os.path.join(folder2, name)) for name in common]

class ImageComparer(tk.Tk):
    def __init__(self, pairs):
        super().__init__()
        self.title("Image Comparer")
        self.pairs = pairs
        self.index = 0

        self.left_label = tk.Label(self)
        self.left_label.grid(row=0, column=0, padx=10, pady=10)
        self.right_label = tk.Label(self)
        self.right_label.grid(row=0, column=1, padx=10, pady=10)

        self.bind("<Right>", self.next_image)
        self.bind("<Left>", self.prev_image)
        self.bind("<Escape>", lambda e: self.destroy())

        self.show_image()

    def show_image(self):
        left_path, right_path = self.pairs[self.index]
        left_img = Image.open(left_path)
        right_img = Image.open(right_path)

        max_height = 600
        max_width = 500

        left_img.thumbnail((max_width, max_height))
        right_img.thumbnail((max_width, max_height))

        self.left_photo = ImageTk.PhotoImage(left_img)
        self.right_photo = ImageTk.PhotoImage(right_img)

        self.left_label.config(image=self.left_photo)
        self.right_label.config(image=self.right_photo)
        self.title(f"Image Comparer ({self.index+1}/{len(self.pairs)}) - {os.path.basename(left_path)}")

    def next_image(self, event=None):
        if self.index < len(self.pairs) - 1:
            self.index += 1
            self.show_image()

    def prev_image(self, event=None):
        if self.index > 0:
            self.index -= 1
            self.show_image()

def main():
    parser = argparse.ArgumentParser(description="Compare images in two folders side by side.")
    parser.add_argument("folder1", help="First folder path")
    parser.add_argument("folder2", help="Second folder path")
    args = parser.parse_args()

    pairs = get_image_pairs(args.folder1, args.folder2)
    if not pairs:
        print("No matching image filenames found in both folders.")
        sys.exit(1)

    app = ImageComparer(pairs)
    app.mainloop()

if __name__ == "__main__":
    main()