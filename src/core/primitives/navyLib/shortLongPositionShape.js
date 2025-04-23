export default class ShortLongPositionShape {

    // Overlay ref, canvas ctx
    constructor(core, opposite = false) {
        this.T = core.props.config.TOOL_COLL;
        this.core = core;
        this.selected = false;
        this.hover = false;
        this.opposite = opposite;
    }

    update(data, selected) {
        const layout = this.core.layout;
        this.selected = selected;

        this.upSizeX = layout.time2x(data.upSizePin[0]);
        this.upSizeY = layout.value2y(data.upSizePin[1]);

        this.commonSizeX = layout.time2x(data.commonSizePin[0]);
        this.commonSizeY = layout.value2y(data.commonSizePin[1]);

        this.bottomSizeX = layout.time2x(data.bottomSizePin[0]);
        this.bottomSizeY = layout.value2y(data.bottomSizePin[1]);

        this.widthSizeX = layout.time2x(data.widthSizePin[0]);
        this.widthSizeY = layout.value2y(data.widthSizePin[1]);
    }

    handleHover(hover) {
        this.hover = hover;
    }

    // Draw the rectangle
    draw(ctx) {
        const profitColor = '#0a9d6130';
        const lossColor = '#da264730';
        const borderColor = 'rgba(0, 0, 0, 0)';

        const profitColor2 = '#0a9d61';
        const lossColor2 = '#da2647';

        const entryY = this.commonSizeY;
        const entryX = this.commonSizeX;

        const isLong = !this.opposite;

        const tpY = isLong ? this.upSizeY : this.bottomSizeY;
        const slY = isLong ? this.bottomSizeY : this.upSizeY;

        const tpValue = Math.abs(this.core.layout.y2value(tpY));
        const slValue = Math.abs(this.core.layout.y2value(slY));
        const entryValue = this.core.layout.y2value(entryY);

        const boxTop = isLong ? Math.min(tpY, entryY) : Math.min(tpY, entryY);
        const boxBottom = isLong ? Math.max(slY, entryY) : Math.min(slY, entryY);

        const boxHeight = isLong ? Math.abs(entryY - tpY) : Math.abs(tpY - entryY);
        const lossBoxHeight = isLong ? Math.abs(entryY - slY) : Math.abs(slY - entryY);

        const boxWidth = this.widthSizeX - this.upSizeX;

        ctx.beginPath();
        ctx.fillStyle = profitColor;
        ctx.strokeStyle = borderColor;
        ctx.rect(this.upSizeX, boxTop, boxWidth, boxHeight);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = lossColor;
        ctx.strokeStyle = borderColor;
        ctx.rect(this.upSizeX, Math.min(slY, entryY), boxWidth, lossBoxHeight);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = '#3a3a3a';
        ctx.lineWidth = 1;
        ctx.moveTo(this.upSizeX, entryY);
        ctx.lineTo(this.widthSizeX, entryY);
        ctx.stroke();

        const fontSize = 12;
        const paddingX = 6;
        const paddingY = 4;
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const drawLabel = (text, x, y, bgColor = '#ffffff') => {
            const textWidth = ctx.measureText(text).width;
            const rectWidth = textWidth + paddingX * 2;
            const rectHeight = fontSize + paddingY * 2;
            const radius = 6;

            const rectX = x - rectWidth / 2;
            const rectY = y - rectHeight / 2;

            ctx.beginPath();
            ctx.fillStyle = bgColor;
            ctx.lineWidth = 1;
            ctx.moveTo(rectX + radius, rectY);
            ctx.arcTo(rectX + rectWidth, rectY, rectX + rectWidth, rectY + rectHeight, radius);
            ctx.arcTo(rectX + rectWidth, rectY + rectHeight, rectX, rectY + rectHeight, radius);
            ctx.arcTo(rectX, rectY + rectHeight, rectX, rectY, radius);
            ctx.arcTo(rectX, rectY, rectX + rectWidth, rectY, radius);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.fillText(text, x, y);
        };

        const targetDifference = tpValue - entryValue;
        const targetPercentDiff = Math.abs((targetDifference / entryValue) * 100);

        const lossDifference = entryValue - slValue;
        const lossPercentDiff = Math.abs((lossDifference / entryValue) * 100);

        const riskRewardRatio = lossPercentDiff === 0 ? 100 : targetPercentDiff / lossPercentDiff;

        if (this.selected || this.hover) {
            const yTL = isLong ? boxTop - 15 : boxTop + boxHeight + 15;
            const ySL = isLong ? boxBottom + 15 : boxBottom - 15;
            drawLabel(`Цель: ${tpValue.toFixed(2)}$ (${targetPercentDiff.toFixed(2)}%)`, this.upSizeX + boxWidth / 2, yTL, profitColor2);
            drawLabel(`Стоп: ${slValue.toFixed(2)}$ (${lossPercentDiff.toFixed(2)}%)`, this.upSizeX + boxWidth / 2, ySL, lossColor2);
            drawLabel(`Вход: ${entryValue.toFixed(2)}$\nСоотношение риск/прибыль: ${riskRewardRatio.toFixed(2)}`, this.upSizeX + boxWidth / 2, entryY - 15, profitColor2);
        }
    }

    collision(x, y) {
        const entryY = this.commonSizeY;
        const isLong = this.upSizeY < this.commonSizeY;

        const tpY = isLong ? this.upSizeY : this.bottomSizeY;
        const slY = isLong ? this.bottomSizeY : this.upSizeY;

        const boxTop = Math.min(tpY, entryY);
        const boxBottom = Math.max(slY, entryY);

        const boxLeft = this.upSizeX;
        const boxRight = this.widthSizeX;

        return (
            x >= boxLeft &&
            x <= boxRight &&
            y >= boxTop &&
            y <= boxBottom
        );
    }
}