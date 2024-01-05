class CanvasUtils {

    constructor(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d");
    }

    clear() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawLine(x1, y1, x2, y2, color, width = 1) {
        this.context.beginPath();
        this.context.moveTo(x1, y1);
        this.context.lineTo(x2, y2);
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.stroke();
    }

    drawRect(x, y, x1, y1, color, width = 1) {
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.strokeRect(x, y, x1 - x, y1 - y);
    }

    drawRectFilled(x, y, x1, y1, color) {
        this.context.fillStyle = color;
        this.context.fillRect(x, y, x1 - x, y1 - y);
    }

    drawRectRounded(x, y, x1, y1, radius, color, width = 1) {
        this.context.save();
        this.context.beginPath();
        this.context.moveTo(x + radius, y);
        this.context.arcTo(x1, y, x1, y1, radius);
        this.context.arcTo(x1, y1, x, y1, radius);
        this.context.arcTo(x, y1, x, y, radius);
        this.context.arcTo(x, y, x1, y, radius);
        this.context.closePath();
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.stroke();
        this.context.restore();
    }

    drawRectRoundedFilled(x, y, x1, y1, radius, color) {
        this.context.save();
        this.context.beginPath();
        this.context.moveTo(x + radius, y);
        this.context.arcTo(x1, y, x1, y1, radius);
        this.context.arcTo(x1, y1, x, y1, radius);
        this.context.arcTo(x, y1, x, y, radius);
        this.context.arcTo(x, y, x1, y, radius);
        this.context.closePath();
        this.context.fillStyle = color;
        this.context.fill();
        this.context.restore();
    }

    drawText(text, x, y, color, isCenter = true, outline = true, size = 12, font = 'Arial') {
        this.context.font = `${size}px ${font}`;
        this.context.textAlign = isCenter ? 'center' : 'left';
        this.context.textBaseline = 'middle';
        if (outline) {
            this.context.strokeStyle = 'black';
            this.context.strokeText(text, x, y);
        }
        this.context.fillStyle = color;
        this.context.fillText(text, x, y);
    }

    drawImage(image, x, y, x1, y1) {
        this.context.drawImage(image, x, y, x1 - x, y1 - y);
    }

    drawImageRounded(image, x, y, x1, y1, radius) {
        this.context.save();
        this.context.beginPath();
        this.context.moveTo(x + radius, y);
        this.context.arcTo(x1, y, x1, y1, radius);
        this.context.arcTo(x1, y1, x, y1, radius);
        this.context.arcTo(x, y1, x, y, radius);
        this.context.arcTo(x, y, x1, y, radius);
        this.context.closePath();
        this.context.clip();
        this.context.drawImage(image, x, y, x1 - x, y1 - y);
        this.context.restore();
    }

    drawImageCircle(image, centerX, centerY, radius) {
        this.context.save();
        this.context.beginPath();
        this.context.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        this.context.closePath();
        this.context.clip();
        this.context.drawImage(image, centerX - radius, centerY - radius, radius * 2, radius * 2);
        this.context.restore();
    }

    drawCircle(x, y, radius, color, width = 1) {
        this.context.beginPath();
        this.context.arc(x, y, radius, 0, 2 * Math.PI);
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.stroke();
    }

    drawCircleFilled(x, y, radius, color) {
        this.context.beginPath();
        this.context.arc(x, y, radius, 0, 2 * Math.PI);
        this.context.fillStyle = color;
        this.context.fill();
    }

    drawLines(points, color, width = 1) {
        this.context.beginPath();
        this.context.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            this.context.lineTo(points[i][0], points[i][1]);
        }
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.stroke();
    }

    drawArcAnimated(x, y, radius, color, width = 1, speed = 1) {
        const time = new Date();
        const angle = (time.getMilliseconds() / 1000 + time.getSeconds()) * speed;
        this.context.beginPath();
        this.context.arc(x, y, radius, angle, angle + 1.5 * Math.PI);
        this.context.strokeStyle = color;
        this.context.lineWidth = width;
        this.context.stroke();
    }
}